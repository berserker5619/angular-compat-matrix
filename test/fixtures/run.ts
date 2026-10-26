// Runs ng-matrix against the fixture libraries and real packages, and checks every result
// against what the spec says it must be. Each fixture fails exactly one check, or none.
//
//   node test/fixtures/run.ts               every case, two at a time
//   node test/fixtures/run.ts healthy-npm   one case (CI runs one per job)
//   node test/fixtures/run.ts --list        case names, as JSON
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CheckName, Report } from '../../src/model.ts';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'dist', 'cli.js');
const libs = join(root, 'fixtures', 'libs');

/** `advisory` is a Partial pass that rests on minVersion alone. */
type Expected = 'pass' | 'fail' | 'not-run' | 'advisory' | 'none' | 'off';
type Row = Partial<Record<CheckName, Expected>>;

interface Case {
  name: string;
  cwd: string;
  args: string[];
  exit: number;
  versions?: Record<number, Row>;
  /** Text one of the findings or hints must contain. */
  says?: RegExp;
  /** The peerDependencies the "no @angular/* peer" finding must suggest. */
  suggests?: Record<string, string>;
  /** Whether the canary package's postinstall must have run. */
  canary?: 'ran' | 'blocked';
  /** For a run that must stop before checking anything: text stderr must contain. */
  stderr?: RegExp;
}

const PASS: Row = { install: 'pass', partial: 'pass', aot: 'pass', strict: 'pass' };
const OLDER: Row = { ...PASS, partial: 'advisory' }; // compiled with Angular 22, checked on an older major
const claimed = (row: Row): Row => ({ peer: 'pass', ...row });
const unclaimed = (row: Row): Row => ({ peer: 'fail', ...row });

const cases: Case[] = [];
for (const pm of ['npm', 'pnpm']) {
  cases.push(
    {
      name: `healthy-${pm}`,
      cwd: join(libs, 'healthy'),
      args: ['--versions', '20-22', '--pm', pm],
      exit: 0,
      versions: { 20: claimed(OLDER), 21: claimed(OLDER), 22: claimed(PASS) },
    },
    {
      name: `peer-narrow-${pm}`,
      cwd: join(libs, 'peer-narrow'),
      args: ['--versions', '21-22', '--pm', pm],
      exit: 0,
      versions: { 21: claimed(OLDER), 22: unclaimed(PASS) },
      says: /works, but peerDependencies doesn't allow it/,
    },
    {
      name: `peer-cdk-${pm}`,
      cwd: join(libs, 'peer-cdk'),
      args: ['--versions', '21-22', '--pm', pm],
      exit: 0,
      versions: { 21: unclaimed(OLDER), 22: claimed(PASS) },
      says: /@angular\/cdk "\^22\.0\.0"/,
    },
    {
      name: `tests-newer-api-${pm}`,
      cwd: join(libs, 'tests-newer-api'),
      args: ['--versions', '20-21', '--tests', '--pm', pm],
      exit: 1,
      versions: { 20: claimed({ ...OLDER, tests: 'fail' }), 21: claimed({ ...OLDER, tests: 'pass' }) },
      // The reason matters: a test command that can't find pnpm exits with 1 too.
      says: /isWritableSignal is missing from @angular\/core 20\./,
    },
    {
      name: `dts-only-${pm}`,
      cwd: join(libs, 'dts-only'),
      args: ['--versions', '21-22', '--pm', pm],
      exit: 1,
      versions: { 21: claimed({ ...OLDER, strict: 'fail' }), 22: claimed(PASS) },
      says: /typings use DebounceTimer/,
    },
  );
}
cases.push(
  {
    name: 'cli-workspace',
    cwd: join(root, 'fixtures', 'workspaces', 'cli-workspace'),
    args: ['--versions', '21-22'],
    exit: 0,
    versions: { 21: claimed(OLDER), 22: claimed(PASS) },
  },
  {
    name: 'partial-too-new',
    cwd: join(libs, 'partial-too-new'),
    args: ['--versions', '21-22'],
    exit: 1,
    versions: { 21: claimed({ install: 'pass', partial: 'fail', aot: 'not-run', strict: 'not-run' }), 22: claimed(PASS) },
    says: /Needs Angular 22\.0\.0 or later.*ClockService/,
  },
  {
    name: 'partial-too-low',
    cwd: join(libs, 'partial-too-low'),
    args: ['--versions', '21'],
    exit: 1,
    versions: { 21: claimed({ install: 'pass', partial: 'advisory', aot: 'fail', strict: 'not-run' }) },
    says: /the linker crashed/,
  },
  {
    name: 'peer-wide',
    cwd: join(libs, 'peer-wide'),
    args: ['--versions', '20-21'],
    exit: 1,
    versions: { 20: claimed({ install: 'pass', partial: 'advisory', aot: 'fail', strict: 'not-run' }), 21: claimed(OLDER) },
    says: /imports isWritableSignal from @angular\/core/,
  },
  {
    name: 'strict-attr',
    cwd: join(libs, 'strict-attr'),
    args: ['--versions', '22'],
    exit: 1,
    versions: { 22: claimed({ ...PASS, strict: 'fail' }) },
    says: /booleanAttribute/,
  },
  // Install scripts: by default the package's postinstall must not run; with --allow-scripts it must.
  ...(['npm', 'pnpm'] as const).flatMap((pm): Case[] => [
    {
      name: `install-scripts-blocked-${pm}`,
      cwd: join(libs, 'install-script-canary'),
      args: ['--versions', '22', '--pm', pm],
      exit: 0,
      versions: { 22: claimed(PASS) },
      canary: 'blocked',
    },
    {
      name: `install-scripts-allowed-${pm}`,
      cwd: join(libs, 'install-script-canary'),
      args: ['--versions', '22', '--pm', pm, '--allow-scripts'],
      exit: 0,
      versions: { 22: claimed(PASS) },
      canary: 'ran',
    },
  ]),
  {
    name: 'consumer',
    cwd: join(libs, 'healthy'),
    args: ['--versions', '21-22', '--consumer', '../../consumers/healthy-example'],
    exit: 0,
    versions: { 21: claimed(OLDER), 22: claimed(PASS) },
  },
  {
    name: 'big-kit',
    cwd: join(libs, 'big-kit'),
    args: ['--versions', '22'],
    exit: 0,
    versions: { 22: claimed(PASS) },
  },
  {
    name: 'full-compilation',
    cwd: join(libs, 'full-compilation'),
    args: ['--versions', '22'],
    exit: 2,
    stderr: /Refusing to pack .* full compilation mode/,
  },
  {
    // The Angular 22 factory whose minVersion is too low, in the real package: Partial still catches
    // it on 21, through the ɵɵngDeclareService next to it.
    name: 'real-material-22-on-21',
    cwd: root,
    args: ['--package', '@angular/material@22.2.3', '--versions', '21'],
    exit: 0,
    versions: { 21: unclaimed({ install: 'pass', partial: 'fail', aot: 'not-run', strict: 'not-run' }) },
    says: /Needs Angular 22\.0\.0 or later/,
  },
  {
    // The whole of Angular Material in one smoke app: 74 entry points, every component and directive.
    name: 'real-material-22',
    cwd: root,
    args: ['--package', '@angular/material@22.2.3', '--versions', '22'],
    exit: 0,
    versions: { 22: claimed(PASS) },
  },
  {
    // Regression: ToastBase and Toast share the selector [toast-component]. In one smoke template
    // they matched the same element, and Angular 22 reports that as NG8023.
    name: 'real-ngx-toastr',
    cwd: root,
    args: ['--package', 'ngx-toastr@20.0.5', '--versions', '22'],
    exit: 0,
    versions: { 22: unclaimed(PASS) },
  },
  {
    // Regression: the date-fns adapter entry point needs date-fns, an optional peer.
    name: 'real-angular-calendar',
    cwd: root,
    args: ['--package', 'angular-calendar@0.32.2', '--versions', '22'],
    exit: 0,
    versions: { 22: claimed(PASS) },
  },
  {
    // Checked by hand on Angular 18 to 22. It declares no peer dependencies at all.
    name: 'real-angular2-multiselect-dropdown',
    cwd: root,
    args: ['--package', 'angular2-multiselect-dropdown@10.0.0', '--versions', '18-22'],
    exit: 0,
    versions: Object.fromEntries([18, 19, 20, 21, 22].map((m) => [m, { peer: 'none', ...PASS }])),
    says: /declares no @angular\/\* peer dependency/,
    // Its code imports @angular/core, @angular/common and @angular/forms.
    suggests: Object.fromEntries(
      ['@angular/common', '@angular/core', '@angular/forms'].map((name) => [name, '^18.0.0 || ^19.0.0 || ^20.0.0 || ^21.0.0 || ^22.0.0']),
    ),
  },
);

function observed(report: Report, major: number): Row {
  const version = report.versions.find((v) => v.major === major);
  if (!version) return {};
  const row: Row = {};
  for (const [name, check] of Object.entries(version.checks) as Array<[CheckName, Report['versions'][number]['checks'][CheckName]]>) {
    row[name] = check.status === 'pass' && check.advisory ? 'advisory' : check.status;
  }
  return row;
}

function run(c: Case): Promise<{ case: Case; problems: string[]; seconds: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const canaryFile = join(tmpdir(), `ngm-canary-${c.name}-${process.pid}`);
    rmSync(canaryFile, { force: true });
    const child = spawn(process.execPath, [cli, ...c.args, '--format', 'json'], {
      cwd: c.cwd,
      env: { ...process.env, NGM_CANARY_FILE: canaryFile },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d));
    child.stderr.on('data', (d: Buffer) => (stderr += d));
    child.on('close', (code) => {
      const problems: string[] = [];
      if (code !== c.exit) problems.push(`exit code ${code}, expected ${c.exit}`);
      if (c.stderr && !c.stderr.test(stderr)) problems.push(`stderr doesn't match ${c.stderr}:\n${stderr}`);
      if (c.canary) {
        const ran = existsSync(canaryFile);
        rmSync(canaryFile, { force: true });
        if (ran !== (c.canary === 'ran')) problems.push(`the package's postinstall ${ran ? 'ran' : "didn't run"}, expected it ${c.canary}`);
      }
      if (c.versions) {
        let report: Report | undefined;
        try {
          report = JSON.parse(stdout) as Report;
        } catch {
          problems.push(`no JSON report. stderr:\n${stderr.split('\n').slice(-20).join('\n')}`);
        }
        if (report) {
          for (const [major, want] of Object.entries(c.versions)) {
            const got = observed(report, Number(major));
            for (const [check, status] of Object.entries(want)) {
              if (got[check as CheckName] !== status) {
                const detail = report.versions.find((v) => v.major === Number(major))?.checks[check as CheckName];
                problems.push(
                  `Angular ${major} ${check}: ${got[check as CheckName] ?? 'missing'}, expected ${status}` +
                    (detail ? `\n    ${detail.message}\n    ${detail.errorLines.slice(0, 6).join('\n    ')}` : ''),
                );
              }
            }
          }
          const setup = report.versions.filter((v) => v.setupError);
          for (const v of setup) problems.push(`Angular ${v.major} setup: ${v.setupError}`);
          if (c.suggests) {
            const suggested = report.findings.find((f) => f.suggestedPeerDependencies)?.suggestedPeerDependencies;
            if (JSON.stringify(suggested) !== JSON.stringify(c.suggests)) {
              problems.push(`suggested peers ${JSON.stringify(suggested)}, expected ${JSON.stringify(c.suggests)}`);
            }
          }
          if (c.says) {
            const text = JSON.stringify(report.findings) + JSON.stringify(report.versions.map((v) => v.checks));
            if (!c.says.test(text.replace(/\\"/g, '"'))) problems.push(`no finding matches ${c.says}`);
          }
        }
      }
      resolve({ case: c, problems, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  process.stdout.write(JSON.stringify(cases.map((c) => c.name)) + '\n');
  process.exit(0);
}
const selected = args.length ? cases.filter((c) => args.includes(c.name)) : cases;
if (args.length && selected.length !== args.length) {
  console.error(`Unknown case. Known: ${cases.map((c) => c.name).join(', ')}`);
  process.exit(2);
}

const concurrency = Number(process.env.NGM_FIXTURE_CONCURRENCY ?? 2);
const queue = [...selected];
// Two cases on the same fixture folder would build it at the same time; one waits for the other.
const busy = new Set<string>();
const take = async (): Promise<Case | undefined> => {
  for (;;) {
    if (!queue.length) return undefined;
    const index = queue.findIndex((c) => c.cwd === root || !busy.has(c.cwd));
    if (index >= 0) {
      // Marked busy here, before any await, so a second worker can't pick the same folder.
      const picked = queue.splice(index, 1)[0];
      busy.add(picked.cwd);
      return picked;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
};
let failed = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let c = await take(); c; c = await take()) {
      const outcome = await run(c).finally(() => busy.delete(c.cwd));
      if (outcome.problems.length) {
        failed++;
        console.log(`✗ ${c.name} (${outcome.seconds} s)\n  ${outcome.problems.join('\n  ')}`);
      } else {
        console.log(`✓ ${c.name} (${outcome.seconds} s)`);
      }
    }
  }),
);
console.log(`\n${selected.length - failed} of ${selected.length} cases as expected.`);
process.exit(failed ? 1 : 0);

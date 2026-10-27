import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { annotations, githubWorkflow, mergeReports, nodeFor, planMatrix, shellQuote, WORKFLOW_PATH } from '../../src/ci.ts';
import { type CheckName, type CheckResult, CHECKS, result, type Report, type VersionReport } from '../../src/model.ts';
import type { AngularMajor } from '../../src/versions.ts';

function version(major: number, claimed: boolean | null, aot: CheckResult = result('pass'), angularVersion = `${major}.2.0`): VersionReport {
  const checks = Object.fromEntries(CHECKS.map((c) => [c, result('pass')])) as Record<CheckName, CheckResult>;
  checks.tests = result('off');
  checks.peer = result(claimed === null ? 'none' : claimed ? 'pass' : 'fail');
  checks.aot = aot;
  if (aot.status === 'fail') checks.strict = result('not-run');
  return { major, angularVersion, supported: true, prerelease: angularVersion.includes('-'), claimed, peerMisses: [], checks, durationMs: 1 };
}

function report(versions: VersionReport[], checkedAt = '2026-10-26T10:00:00.000Z'): Report {
  return {
    schemaVersion: 1,
    tool: { name: 'angular-compat-matrix', version: '0.3.0' },
    checkedAt,
    library: { name: 'my-lib', version: '1.0.0', source: 'test', declarations: 1 },
    packageManager: 'npm',
    installScripts: 'toolchain-only',
    node: 'v24.19.0',
    versions,
    findings: [],
    exitCode: 0,
  };
}

function major(n: number, nodeRanges: string[], prerelease = false): AngularMajor {
  return { major: n, version: prerelease ? `${n}.1.0-next.1` : `${n}.2.0`, cliVersion: `${n}.2.0`, supported: true, nodeRanges, prerelease };
}

describe('ci: Node for each job', () => {
  it('picks the newest Node major every range allows', () => {
    assert.equal(nodeFor(['^20.19.0 || ^22.12.0 || >=24.0.0', '>=22.12.0']), '24');
    assert.equal(nodeFor(['^18.13.0 || >=20.9.0', '>=22.12.0']), '22');
  });

  it('falls back to the current LTS when nothing fits', () => {
    assert.equal(nodeFor(['^18.0.0', '>=22.12.0']), 'lts/*');
  });
});

describe('ci: plan', () => {
  it('gives each major its own --versions, and next comes with the newest stable major', () => {
    const plan = planMatrix([major(21, ['>=20.19.0']), major(22, ['>=22.12.0']), major(23, ['>=24.0.0'], true)], { version: '0.3.0', node: '>=22.12.0' });
    assert.deepEqual(plan, [
      { name: '21', node: '22', args: '--versions 21', tool: '0.3.0' },
      { name: '22', node: '22', args: '--versions 22', tool: '0.3.0' },
      { name: 'next', node: '24', args: '--versions 22 --next', tool: '0.3.0' },
    ]);
  });
});

describe('ci: summary', () => {
  it('joins one-version reports, drops the duplicate row from --next, and recomputes findings and exit code', () => {
    const { report: merged, notes } = mergeReports(
      [
        report([version(22, true)]),
        report([version(20, true, result('fail', 'failed', { hint: 'the hint' }))], '2026-10-26T09:00:00.000Z'),
        report([version(22, true), version(22, true, result('pass'), '22.3.0-next.1')]),
      ],
      [],
    );
    assert.deepEqual(merged.versions.map((v) => v.angularVersion), ['20.2.0', '22.2.0', '22.3.0-next.1']);
    assert.equal(merged.checkedAt, '2026-10-26T09:00:00.000Z');
    assert.equal(merged.exitCode, 1);
    assert.deepEqual(merged.findings.map((f) => [f.level, f.majors, f.text]), [['error', [20], 'AOT build: the hint']]);
    assert.deepEqual(notes, []);
  });

  it('exits 1 for a broken claimed version, 2 for a setup problem or missing report, else 0', () => {
    const exit = (versions: VersionReport[], unreadable: string[] = []) => mergeReports(versions.map((v) => report([v])), unreadable).report.exitCode;
    const unclaimedFail = version(23, false, result('fail', 'x'));
    assert.equal(exit([version(22, true), version(21, false), unclaimedFail]), 0, 'works but not claimed, or fails outside the range: never red');
    assert.equal(exit([version(21, true, result('fail', 'x')), version(22, true), unclaimedFail]), 1);
    assert.equal(exit([{ ...version(21, true), setupError: 'ng new failed' }, version(22, true, result('fail', 'x'))]), 2);
    assert.equal(exit([version(22, true)], ['angular-21.json']), 2);
  });

  it('notes which job left no report', () => {
    const { notes } = mergeReports([report([version(22, true)])], ['results/angular-21.json']);
    assert.match(notes[0], /results\/angular-21\.json/);
  });

  it('refuses reports from another schema version or another package', () => {
    assert.throws(() => mergeReports([report([version(21, true)]), { ...report([version(22, true)]), schemaVersion: 2 }], []), /schemaVersion 2/);
    const other = report([version(22, true)]);
    other.library = { ...other.library, version: '1.0.1' };
    assert.throws(() => mergeReports([report([version(21, true)]), other], []), /different packages: my-lib@1\.0\.0 and my-lib@1\.0\.1/);
  });

  it('keeps the missing-peer finding, with one range from every version that passed', () => {
    const peerless = (n: number) => {
      const r = report([version(n, null)]);
      r.findings = [{ level: 'warning', majors: [], text: 'x', suggestedPeerDependencies: { '@angular/common': `^${n}.0.0`, '@angular/core': `^${n}.0.0` } }];
      return r;
    };
    const { report: merged } = mergeReports([peerless(21), peerless(22)], []);
    assert.deepEqual(merged.findings[0].suggestedPeerDependencies, {
      '@angular/common': '^21.0.0 || ^22.0.0',
      '@angular/core': '^21.0.0 || ^22.0.0',
    });
  });
});

describe('ci: annotations', () => {
  it('turns errors and warnings into GitHub annotations, and skips notes', () => {
    const r = report([version(20, true), version(23, false)]);
    r.findings = [
      { level: 'error', majors: [20], text: 'AOT build: needs 50%\nmore' },
      { level: 'warning', majors: [23], text: 'works, but not claimed' },
      { level: 'note', majors: [19], text: 'expected' },
    ];
    assert.deepEqual(annotations(r), [
      '::error title=angular-compat-matrix::my-lib@1.0.0, Angular 20: AOT build: needs 50%25%0Amore',
      '::warning title=angular-compat-matrix::my-lib@1.0.0, Angular 23: works, but not claimed',
    ]);
  });
});

describe('ci: workflow', () => {
  const npm = githubWorkflow({ command: 'npx --yes angular-compat-matrix@1.0.0', args: [], planArgs: [], install: 'npm ci', installForPlan: false });

  it('quotes only arguments that need it', () => {
    assert.equal(shellQuote('fixtures/libs/healthy'), 'fixtures/libs/healthy');
    assert.equal(shellQuote('npx nx build my-lib'), `'npx nx build my-lib'`);
    assert.equal(shellQuote(`it's`), `'it'\\''s'`);
  });

  it('gives --versions to plan only, and installs for plan only with a workspace command', () => {
    const npx = githubWorkflow({ command: 'npx --yes angular-compat-matrix@1.0.0', args: ['--build', 'npx nx build lib'], planArgs: ['--versions', '18-22'], install: 'npm ci', installForPlan: false });
    assert.match(npx, /ci plan --versions 18-22 --build 'npx nx build lib'\)/);
    assert.match(npx, /\$\{\{ matrix\.args \}\} --build 'npx nx build lib' --format json/);
    assert.equal(npx.match(/run: npm ci/g)?.length, 1);
  });

  it('only reads the repo, and lets every major finish', () => {
    assert.match(npm, /\npermissions:\n {2}contents: read\n/);
    assert.match(npm, /strategy:\n {6}fail-fast: false\n/);
  });

  it('caches the tools per tool version and Angular major', () => {
    assert.match(npm, /key: angular-compat-matrix-tools-\$\{\{ runner\.os \}\}-\$\{\{ matrix\.tool \}\}-\$\{\{ matrix\.name \}\}-\$\{\{ github\.run_id \}\}\n/);
    assert.match(npm, /restore-keys: angular-compat-matrix-tools-\$\{\{ runner\.os \}\}-\$\{\{ matrix\.tool \}\}-\$\{\{ matrix\.name \}\}-\n/);
  });

  it('keeps the summary exit code through tee', () => {
    assert.match(npm, /shell: bash\n {8}run: .* ci summary .*\| tee -a "\$GITHUB_STEP_SUMMARY"/);
  });

  it('sets up pnpm before installing in a pnpm workspace, and not otherwise', () => {
    assert.doesNotMatch(npm, /pnpm\/action-setup|pnpm install/);
    const pinned = githubWorkflow({ command: 'npx x', args: [], planArgs: [], install: 'pnpm install --frozen-lockfile', installForPlan: false, pnpm: '12.15.0' });
    assert.match(pinned, /- uses: pnpm\/action-setup@v6\n {8}with:\n {10}version: 12\.15\.0\n {6}- name: Install dependencies\n {8}run: pnpm install --frozen-lockfile/);
    const declared = githubWorkflow({ command: 'npx x', args: [], planArgs: [], install: 'pnpm install --frozen-lockfile', installForPlan: false, pnpm: '' });
    assert.match(declared, /- uses: pnpm\/action-setup@v6\n {6}- name: Install dependencies/);
  });

  it("matches this repo's own workflow, which runs it against the healthy fixture", () => {
    const expected = githubWorkflow({
      command: 'node dist/cli.js',
      args: ['--cwd', 'fixtures/libs/healthy', '--pm', 'npm'],
      planArgs: [],
      install: 'npm ci && npm ci --prefix fixtures && npm run build',
      installForPlan: true,
    });
    const committed = readFileSync(join(import.meta.dirname, '..', '..', WORKFLOW_PATH), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(committed, expected, 'regenerate it with the command in the README’s Development section');
  });
});

describe('ci github', () => {
  const cli = join(import.meta.dirname, '..', '..', 'src', 'cli.ts');
  /** A pnpm repository whose package.json names its pnpm. */
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'acm-ci-'));
    writeFileSync(join(dir, 'ng-package.json'), '{}');
    writeFileSync(join(dir, 'package.json'), '{ "name": "my-lib", "packageManager": "pnpm@10.0.0" }');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    return dir;
  };
  const run = (dir: string, ...args: string[]) => spawnSync(process.execPath, [cli, 'ci', 'github', ...args], { cwd: dir, encoding: 'utf8' });

  it('prints the workflow with --print and writes nothing', () => {
    const dir = repo();
    const out = execFileSync(process.execPath, [cli, 'ci', 'github', '--print'], { cwd: dir, encoding: 'utf8' });
    assert.match(out, /^# Written by `angular-compat-matrix ci github`/);
    assert.match(out, /- uses: pnpm\/action-setup@v6\n {6}- name: Install dependencies\n {8}run: pnpm install --frozen-lockfile/);
    assert.ok(!existsSync(join(dir, WORKFLOW_PATH)));
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to overwrite a workflow without --force', () => {
    const dir = repo();
    assert.equal(run(dir).status, 0);
    writeFileSync(join(dir, WORKFLOW_PATH), 'mine');
    const refused = run(dir);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /already exists\. Pass --force/);
    assert.equal(readFileSync(join(dir, WORKFLOW_PATH), 'utf8'), 'mine');
    assert.equal(run(dir, '--force').status, 0);
    assert.notEqual(readFileSync(join(dir, WORKFLOW_PATH), 'utf8'), 'mine');
    rmSync(dir, { recursive: true, force: true });
  });
});

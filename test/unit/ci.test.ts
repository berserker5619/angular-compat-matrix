import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { githubWorkflow, mergeReports, nodeFor, planMatrix, shellQuote, WORKFLOW_PATH } from '../../src/ci.ts';
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
    const plan = planMatrix([major(21, ['>=20.19.0']), major(22, ['>=22.12.0']), major(23, ['>=24.0.0'], true)], '>=22.12.0');
    assert.deepEqual(plan, [
      { name: '21', node: '22', args: '--versions 21' },
      { name: '22', node: '22', args: '--versions 22' },
      { name: 'next', node: '24', args: '--versions 22 --next' },
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

  it('exits 2 when a job left no report', () => {
    const { report: merged, notes } = mergeReports([report([version(22, true)])], ['results/angular-21.json']);
    assert.equal(merged.exitCode, 2);
    assert.match(notes[0], /results\/angular-21\.json/);
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

describe('ci: workflow', () => {
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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type CheckName, type CheckResult, CHECKS, result, type Report, type VersionReport } from '../../src/model.ts';
import { exitCode, findings, majorsText, renderMarkdown, renderTerminal } from '../../src/report.ts';

function version(major: number, claimed: boolean | null, statuses: Partial<Record<CheckName, CheckResult>>): VersionReport {
  const checks = Object.fromEntries(CHECKS.map((c) => [c, result('pass')])) as Record<CheckName, CheckResult>;
  checks.tests = result('off');
  checks.peer = result(claimed === null ? 'none' : claimed ? 'pass' : 'fail');
  let failed = false;
  for (const name of ['install', 'partial', 'aot', 'strict', 'tests'] as CheckName[]) {
    if (failed && name !== 'tests') checks[name] = result('not-run');
    if (statuses[name]) {
      checks[name] = statuses[name]!;
      if (statuses[name]!.status === 'fail') failed = true;
    }
  }
  return {
    major,
    angularVersion: `${major}.2.0`,
    supported: true,
    prerelease: false,
    claimed,
    peerMisses: claimed === false ? [{ name: '@angular/core', range: '^21.0.0', version: `${major}.2.0` }] : [],
    checks,
    durationMs: 1000,
  };
}

const partialFail = result('fail', 'Needs Angular 20.0.0 or later: highest minVersion 20.0.0, in MyDropdownComponent.', {
  hint: 'Build the library with the oldest Angular you support, or take this version out of the peer range.',
});

describe('exit code', () => {
  it('is 1 only when a claimed version fails', () => {
    assert.equal(exitCode([version(21, true, {}), version(22, false, { aot: result('fail', 'x') })]), 0);
    assert.equal(exitCode([version(21, true, { strict: result('fail', 'x') })]), 1);
  });

  it('is 0 when nothing is claimed, even if something fails', () => {
    assert.equal(exitCode([version(22, null, { aot: result('fail', 'x') })]), 0);
  });

  it("is 2 when ng-matrix couldn't set a version up", () => {
    assert.equal(exitCode([{ ...version(21, true, {}), setupError: 'ng new failed' }]), 2);
  });
});

describe('findings', () => {
  it('merges the same problem across majors and orders errors first', () => {
    const list = findings(
      [version(18, true, { partial: partialFail }), version(19, true, { partial: partialFail }), version(22, false, {})],
      { peerDependencies: { '@angular/core': '^18.0.0 || ^19.0.0 || ^20.0.0 || ^21.0.0' } },
    );
    assert.equal(list[0].level, 'error');
    assert.deepEqual(list[0].majors, [18, 19]);
    assert.match(list[0].text, /^partial: Needs Angular 20\.0\.0.*MyDropdownComponent.*oldest Angular you support/);
    assert.equal(list[1].level, 'warning');
    assert.match(list[1].text, /works, but peerDependencies doesn't allow it \(@angular\/core "\^21\.0\.0"\)/);
  });

  it('suggests peers for every Angular package the code imports, from the majors that passed', () => {
    const list = findings([version(20, null, {}), version(21, null, {}), version(22, null, { aot: result('fail', 'x') })], {}, [
      '@angular/common',
      '@angular/forms',
    ]);
    const range = '^20.0.0 || ^21.0.0';
    assert.deepEqual(list.at(-1)!.suggestedPeerDependencies, { '@angular/common': range, '@angular/core': range, '@angular/forms': range });
  });

  it('has no range to suggest when nothing passed', () => {
    const list = findings([version(22, null, { aot: result('fail', 'x') })], {});
    assert.equal(list.at(-1)!.suggestedPeerDependencies, undefined);
    assert.match(list.at(-1)!.text, /no range to suggest/);
  });

  it('suggests a peer range when the package declares none', () => {
    const list = findings([version(20, null, {}), version(21, null, {}), version(22, null, { aot: result('fail', 'x') })], {});
    assert.match(list.at(-1)!.text, /"@angular\/core": "\^20\.0\.0 \|\| \^21\.0\.0"/);
  });

  it('writes major lists as ranges', () => {
    assert.equal(majorsText([18, 19, 20, 22]), '18–20, 22');
  });

  it('points a failing version with skipped install scripts at --allow-scripts, and only a failing one', () => {
    const skipped = { skippedInstallScripts: ['core-js@3.46.0'] };
    const list = findings(
      [{ ...version(21, true, { aot: result('fail', 'x') }), ...skipped }, { ...version(22, true, {}), ...skipped }],
      { peerDependencies: { '@angular/core': '^21.0.0 || ^22.0.0' } },
    );
    const notes = list.filter((f) => /--allow-scripts/.test(f.text));
    assert.equal(notes.length, 1);
    assert.deepEqual(notes[0].majors, [21]);
    assert.match(notes[0].text, /core-js@3\.46\.0/);
  });

  it('reports skipLibCheck typings errors as a warning finding and does not fail exit code', () => {
    const v22 = version(22, true, {});
    v22.dtsErrors = true;
    const list = findings([v22], { peerDependencies: { '@angular/core': '^22.0.0' } });
    assert.equal(list.length, 1);
    assert.equal(list[0].level, 'warning');
    assert.deepEqual(list[0].majors, [22]);
    assert.equal(list[0].text, 'library typings have errors with skipLibCheck: false');
    assert.equal(exitCode([v22]), 0);
  });

  it('reports undeclared entry point dependencies as warnings', () => {
    const v21 = version(21, true, {});
    v21.omittedEntryPoints = [{ entry: 'primeng/chart', missingPackage: 'chart.js' }];
    const v22 = version(22, true, {});
    v22.omittedEntryPoints = [{ entry: 'primeng/chart', missingPackage: 'chart.js' }];
    const list = findings([v21, v22], { peerDependencies: { '@angular/core': '^21.0.0 || ^22.0.0' } });
    const warn = list.find((f) => f.text.includes('primeng/chart'));
    assert.ok(warn);
    assert.equal(warn.level, 'warning');
    assert.deepEqual(warn.majors, [21, 22]);
    assert.equal(warn.text, "entry point primeng/chart imports chart.js, which isn't declared in dependencies or peers");
  });
});

describe('rendering', () => {
  const report: Report = {
    schemaVersion: 1,
    tool: { name: 'angular-compat-matrix', version: '0.1.0' },
    checkedAt: '2026-10-26T10:00:00.000Z',
    library: { name: 'my-dropdown', version: '3.0.0', source: 'test', compiledWith: '21.2.0', highestMinVersion: '20.0.0', declarations: 4 },
    packageManager: 'npm',
    installScripts: 'toolchain-only',
    node: 'v24.19.0',
    versions: [
      version(19, true, { partial: partialFail }),
      version(20, true, { strict: result('fail', 'Fails with strictTemplates: true and skipLibCheck: false.', { errorLines: ['X [ERROR] TS2322'] }) }),
      version(21, true, {}),
      version(22, false, {}),
    ],
    findings: [],
    exitCode: 1,
  };
  report.findings = findings(report.versions, { peerDependencies: { '@angular/core': '^19.0.0 || ^20.0.0 || ^21.0.0' } });

  it('draws the terminal table like the spec', () => {
    const text = renderTerminal(report);
    assert.match(text, /^my-dropdown@3\.0\.0 \(compiled with Angular 21\.2\.0; highest minVersion 20\.0\.0\)/);
    assert.match(text, /Angular 19 +✓ +✓ +✗ +— +—/);
    assert.match(text, /Angular 20 +✓ +✓ +✓ +✓ +✗/);
    assert.match(text, /Angular 22 +✗ +✓ +✓ +✓ +✓/);
    assert.doesNotMatch(text, /tests/);
    assert.match(text, /✗ 19: partial: Needs Angular 20\.0\.0/);
    assert.match(text, /! 22: works, but peerDependencies/);
    assert.match(text, /Angular 20, strict types:\n {2}X \[ERROR\] TS2322/);
  });

  it('writes a Markdown table with the date and version', () => {
    const md = renderMarkdown(report);
    assert.match(md, /Checked on 2026-10-26 for `my-dropdown@3\.0\.0`/);
    assert.match(md, /\| Angular \| Peer range \| Install \| Partial \| AOT build \| Strict types \|/);
    assert.match(md, /\| 19 \(19\.2\.0\) \| ✅ \| ✅ \| ❌ \| — \| — \|/);
  });
});

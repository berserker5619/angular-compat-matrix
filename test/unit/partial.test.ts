import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { angularImports, judgePartial, scanSource, summarize } from '../../src/partial.ts';

// Shaped like Angular Material 22's sort.mjs: the factory understates its minVersion.
const material22 = `
class MatSortHeaderIntl {
  changes = new Subject();
  static ɵfac = i0.ɵɵngDeclareFactory({
    minVersion: "12.0.0",
    version: "22.2.1",
    ngImport: i0,
    type: MatSortHeaderIntl,
    deps: [],
    target: i0.ɵɵFactoryTarget.Service
  });
  static ɵprov = i0.ɵɵngDeclareService({
    minVersion: "22.0.0",
    version: "22.2.1",
    ngImport: i0,
    type: MatSortHeaderIntl
  });
}
class MatSort {
  static ɵdir = i0.ɵɵngDeclareDirective({ minVersion: "17.1.0", version: "22.2.1", type: MatSort, isStandalone: true });
}`;

describe('reading minVersion', () => {
  const declarations = scanSource(material22, 'fesm2022/sort.mjs');

  it('finds every ɵɵngDeclare call', () => {
    assert.deepEqual(
      declarations.map((d) => `${d.kind} ${d.type} ${d.minVersion}`),
      ['Factory MatSortHeaderIntl 12.0.0', 'Service MatSortHeaderIntl 22.0.0', 'Directive MatSort 17.1.0'],
    );
  });

  it('reports the highest minVersion and the version that compiled the package', () => {
    const summary = summarize(declarations);
    assert.equal(summary.highest?.minVersion, '22.0.0');
    assert.equal(summary.highest?.type, 'MatSortHeaderIntl');
    assert.equal(summary.compiledWith, '22.2.1');
  });

  it("ignores Angular's own 0.0.0-PLACEHOLDER builds for 'compiled with'", () => {
    const summary = summarize(scanSource(`ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "0.0.0-PLACEHOLDER", type: X })`, 'a.mjs'));
    assert.equal(summary.compiledWith, undefined);
  });
});

describe('judging a version', () => {
  const summary = summarize(scanSource(material22, 'sort.mjs'));

  it('fails, trusted, when the highest minVersion is newer than the app', () => {
    const verdict = judgePartial(summary, '21.2.25');
    assert.equal(verdict.pass, false);
    assert.match(verdict.message, /22\.0\.0.*MatSortHeaderIntl/);
  });

  it('passes on the same major', () => {
    assert.deepEqual(judgePartial(summary, '22.2.3').pass, true);
    assert.equal(judgePartial(summary, '22.2.3').advisory, false);
  });

  it('calls a pass only advisory when the package was compiled with a newer major', () => {
    const lowered = summarize(scanSource(material22.replace('"22.0.0"', '"12.0.0"'), 'sort.mjs'));
    const verdict = judgePartial(lowered, '21.2.25');
    assert.equal(verdict.pass, true);
    assert.equal(verdict.advisory, true);
  });

  it('compares pre-releases by their numbers', () => {
    assert.equal(judgePartial(summary, '22.3.0-next.2').pass, true);
  });

  it('passes a package with no declarations', () => {
    assert.equal(judgePartial(summarize([]), '17.3.12').pass, true);
  });
});

describe('Angular imports', () => {
  it('lists the @angular/* packages the published code imports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ngm-imports-'));
    try {
      mkdirSync(join(dir, 'fesm2022'));
      writeFileSync(
        join(dir, 'fesm2022', 'lib.mjs'),
        `import * as i0 from '@angular/core';\nimport { NgIf } from "@angular/common";\nimport { HttpClient } from '@angular/common/http';\nconst forms = import('@angular/forms');\nimport { of } from 'rxjs';`,
      );
      assert.deepEqual(angularImports(dir), ['@angular/common', '@angular/core', '@angular/forms']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

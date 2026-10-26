import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findUndeclaredImports, hintFor, isDtsOnlyFailure } from '../../src/build.ts';
import { errorLines } from '../../src/exec.ts';

describe('build hints', () => {
  it('explains the linker crash Angular Material 22 causes in an Angular 21 app', () => {
    const output = `X [ERROR] Cannot create property 'message' on string 'C:\\app\\node_modules\\@angular\\material\\fesm2022\\sort.mjs: Unsupported enum value for [object Object]
  442 |     type: MatSortHeaderIntl,
> 444 |     target: i0.ɵɵFactoryTarget.Service`;
    assert.match(hintFor(output)!, /features newer than this Angular.*linker crashed/);
  });

  it("explains the linker's own minVersion refusal", () => {
    const output =
      'This application depends upon a library published using Angular version 22.2.3, which requires Angular version 22.0.0 or newer to work correctly.';
    assert.match(hintFor(output)!, /compiled with Angular 22\.2\.3 and needs Angular 22\.0\.0 or newer/);
  });

  it('names a runtime API the app version lacks', () => {
    const output = `X [ERROR] No matching export in "node_modules/@angular/core/fesm2022/core.mjs" for import "isWritableSignal"`;
    assert.equal(hintFor(output), "The package imports isWritableSignal from @angular/core, which this Angular version doesn't have.");
  });

  for (const [manager, path] of [
    ['npm', 'node_modules/ngm-fixture-dts-only/types/ngm-fixture-dts-only.d.ts:2:9:'],
    ['pnpm', 'node_modules/.pnpm/ngm-fixture-dts-only@file+n_d96/node_modules/ngm-fixture-dts-only/types/ngm-fixture-dts-only.d.ts:2:9:'],
  ]) {
    it(`names the package and type behind a .d.ts error (${manager} layout)`, () => {
      const output = `X [ERROR] TS2305: Module '"@angular/core"' has no exported member 'DebounceTimer'. [plugin angular-compiler]

    ${path}
      2 │ import { DebounceTimer } from "@angular/core";`;
      assert.equal(
        hintFor(output),
        "ngm-fixture-dts-only's typings use DebounceTimer, which this version's @angular/core doesn't export. Apps with skipLibCheck: false, or that use the type, fail to compile.",
      );
    });
  }

  it('points at booleanAttribute for strict template errors', () => {
    const output = `X [ERROR] TS2322: Type 'string' is not assignable to type 'boolean'. [plugin angular-compiler]
    src/ngm-smoke.ts:10:5:`;
    assert.match(hintFor(output)!, /booleanAttribute/);
  });

  it('recognizes dts-only errors with skipLibCheck: false', () => {
    const output = `X [ERROR] TS2307: Cannot find module 'node_modules/rxjs/dist/types' or its corresponding type declarations. [plugin angular-compiler]
    node_modules/@coreui/angular/types/coreui-angular.d.ts:2148:26:`;
    assert.equal(hintFor(output), 'library typings have errors with skipLibCheck: false');
  });

  it('has no hint for an unknown failure', () => {
    assert.equal(hintFor('Something else went wrong'), undefined);
  });
});

describe('dts-only classification', () => {
  it('returns true when all errors are in .d.ts files', () => {
    const lines = [
      "X [ERROR] TS2307: Cannot find module 'rxjs/types'",
      '    node_modules/@coreui/angular/types/coreui-angular.d.ts:2148:26:',
    ];
    assert.equal(isDtsOnlyFailure(lines), true);
  });

  it('returns false when errors are in application templates or components', () => {
    const lines = [
      "X [ERROR] TS2322: Type 'string' is not assignable to type 'boolean'",
      '    src/ngm-smoke.ts:118:9:',
    ];
    assert.equal(isDtsOnlyFailure(lines), false);
  });
});

describe('undeclared imports in entry points', () => {
  it('detects undeclared imports like chart.js and maps them to entry points', () => {
    const manifest = {
      name: 'primeng',
      exports: {
        '.': { default: './fesm2022/primeng.mjs' },
        './chart': { default: './fesm2022/primeng-chart.mjs' },
      },
      dependencies: { tslib: '^2.0.0' },
      peerDependencies: { '@angular/core': '^22.0.0' },
    };
    const lines = [
      'X [ERROR] Could not resolve "chart.js/auto"',
      '    node_modules/primeng/fesm2022/primeng-chart.mjs:4:18:',
      '      4 │ import Chart from "chart.js/auto";',
    ];
    const result = findUndeclaredImports(lines, manifest, ['primeng', 'primeng/chart']);
    assert.deepEqual(result, [{ entry: 'primeng/chart', missingPackage: 'chart.js' }]);
  });

  it('detects lodash in a single-entry-point library', () => {
    const manifest = {
      name: 'ngx-guided-tour',
      dependencies: { tslib: '^2.0.0' },
      peerDependencies: { '@angular/core': '>=13.0.0' },
    };
    const lines = [
      'X [ERROR] Could not resolve "lodash"',
      '    node_modules/ngx-guided-tour/fesm2020/ngx-guided-tour.mjs:5:26:',
    ];
    const result = findUndeclaredImports(lines, manifest, ['ngx-guided-tour']);
    assert.deepEqual(result, [{ entry: 'ngx-guided-tour', missingPackage: 'lodash' }]);
  });

  it('ignores packages declared in dependencies or peers', () => {
    const manifest = {
      name: 'my-lib',
      dependencies: { lodash: '^4.0.0' },
      peerDependencies: {},
    };
    const lines = [
      'X [ERROR] Could not resolve "lodash"',
      '    node_modules/my-lib/fesm2022/my-lib.mjs:5:26:',
    ];
    const result = findUndeclaredImports(lines, manifest, ['my-lib']);
    assert.deepEqual(result, []);
  });
});

describe('error lines', () => {
  it('picks the error and the lines after it', () => {
    const lines = errorLines(['Building...', 'X [ERROR] TS2322: bad', '  at file.ts:1:1', '', 'done'].join('\n'));
    assert.deepEqual(lines, ['X [ERROR] TS2322: bad', '  at file.ts:1:1', 'done']);
  });

  it('falls back to the last lines when nothing looks like an error', () => {
    assert.deepEqual(errorLines('a\nb\nc', 2), ['b', 'c']);
  });
});

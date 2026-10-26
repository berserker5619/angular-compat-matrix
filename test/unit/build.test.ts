import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hintFor } from '../../src/build.ts';
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
    const output = `X [ERROR] TS2322: Type 'string' is not assignable to type 'boolean'. [plugin angular-compiler]`;
    assert.match(hintFor(output)!, /booleanAttribute/);
  });

  it('has no hint for an unknown failure', () => {
    assert.equal(hintFor('Something else went wrong'), undefined);
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

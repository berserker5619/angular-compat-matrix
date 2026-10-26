import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Declarable, entryPoints, parseSelector, type PublicApi, renderSmoke } from '../../src/smoke.ts';

describe('selectors', () => {
  it('reads element, attribute and class selectors', () => {
    assert.deepEqual(parseSelector('ngm-card'), { tag: 'ngm-card', attributes: [], classes: [] });
    assert.deepEqual(parseSelector('[ngmHighlight]'), { tag: undefined, attributes: [{ name: 'ngmHighlight', value: undefined }], classes: [] });
    assert.deepEqual(parseSelector('input[type=checkbox][myCheck]'), {
      tag: 'input',
      attributes: [
        { name: 'type', value: 'checkbox' },
        { name: 'myCheck', value: undefined },
      ],
      classes: [],
    });
    assert.deepEqual(parseSelector('.my-class'), { tag: undefined, attributes: [], classes: ['my-class'] });
  });

  it('takes the first alternative and drops :not()', () => {
    assert.deepEqual(parseSelector('button[mat-button], a[mat-button]')?.tag, 'button');
    assert.deepEqual(parseSelector('[formControl]:not([ngNoForm]), x')?.attributes, [{ name: 'formControl', value: undefined }]);
  });
});

describe('entry points', () => {
  it('lists every entry with typings from the exports map', () => {
    const manifest = {
      name: 'lib',
      exports: {
        './package.json': { default: './package.json' },
        '.': { types: './types/lib.d.ts', default: './fesm2022/lib.mjs' },
        './testing': { types: './types/lib-testing.d.ts', default: './fesm2022/lib-testing.mjs' },
        './theme.css': './theme.css',
      },
    };
    assert.deepEqual(entryPoints(manifest), ['lib', 'lib/testing']);
  });

  it('falls back to the package name without an exports map', () => {
    assert.deepEqual(entryPoints({ name: 'old-lib', typings: 'index.d.ts' }), ['old-lib']);
  });
});

const api: PublicApi = {
  entries: ['lib', 'lib/testing'],
  declarables: [
    {
      id: 'd0',
      kind: 'component',
      className: 'CardComponent',
      exportName: 'CardComponent',
      entry: 'lib',
      selector: 'lib-card',
      standalone: true,
      inputs: [
        { property: 'title', alias: 'title', required: true, accessible: true, bare: true },
        { property: 'elevation', alias: 'elevation', required: false, accessible: true, bare: true },
      ],
      typeParams: 0,
    },
    {
      id: 'd1',
      kind: 'directive',
      className: 'ToggleDirective',
      exportName: 'ToggleDirective',
      entry: 'lib',
      selector: '[libToggle]',
      standalone: true,
      inputs: [{ property: 'libToggle', alias: 'libToggle', required: false, accessible: true, bare: true }],
      typeParams: 0,
    },
    {
      id: 'd2',
      kind: 'component',
      className: 'BadgeComponent',
      selector: 'lib-badge',
      standalone: false,
      inputs: [{ property: 'label', alias: 'label', required: true, accessible: true, bare: true }],
      typeParams: 0,
    },
    {
      id: 'd3',
      kind: 'component',
      className: 'ListComponent',
      exportName: 'ListComponent',
      entry: 'lib/testing',
      selector: 'lib-list',
      standalone: true,
      inputs: [{ property: 'items', alias: 'items', required: true, accessible: true, bare: true }],
      typeParams: 1,
    },
    {
      id: 'd5',
      kind: 'directive',
      className: 'SizeDirective',
      exportName: 'SizeDirective',
      entry: 'lib',
      selector: '[libSize]',
      standalone: true,
      inputs: [{ property: 'libSize', alias: 'libSize', required: false, accessible: true, bare: false }],
      typeParams: 0,
    },
    {
      id: 'd6',
      kind: 'directive',
      className: 'BaseDirective',
      exportName: 'BaseDirective',
      entry: 'lib',
      standalone: true,
      inputs: [],
      typeParams: 0,
    },
    {
      id: 'd4',
      kind: 'component',
      className: 'Unused',
      exportName: 'UnusedComponent',
      entry: 'lib',
      selector: 'lib-unused',
      standalone: false,
      inputs: [],
      typeParams: 0,
    },
  ],
  pipes: [{ id: 'p0', className: 'FormatPipe', exportName: 'FormatPipe', entry: 'lib', pipeName: 'format', standalone: true, extraArgs: 2 }],
  modules: [{ id: 'm0', exportName: 'BadgeModule', entry: 'lib', exports: ['d2'] }],
  services: [{ exportName: 'CardService', entry: 'lib', typeParams: 0 }],
};

describe('the smoke component', () => {
  const smoke = renderSmoke(api, { signalWriteBrand: true });

  it('gives each NgModule and each standalone declarable a component of its own', () => {
    for (const name of ['BadgeModule', 'CardComponent', 'ToggleDirective', 'ListComponent', 'SizeDirective', 'FormatPipe']) {
      assert.match(smoke.component, new RegExp(`imports: \\[${name}\\]`), name);
    }
    assert.match(smoke.component, /selector: 'app-root',\n  standalone: true,\n  imports: \[NgmUse0, NgmUse1, NgmUse2, NgmUse3, NgmUse4, NgmUse5\]/);
    assert.match(smoke.component, /<ngm-use-5><\/ngm-use-5>/);
  });

  it("doesn't import an abstract base directive with no selector", () => {
    assert.doesNotMatch(smoke.component, /BaseDirective/);
  });

  it('binds a selector attribute that takes a number, as users would', () => {
    assert.match(smoke.component, /<div \[libSize\]="v\d+"><\/div>/);
  });

  it('binds required inputs with values of their write type', () => {
    const name = /<lib-card \[title\]="(v\d+)"><\/lib-card>/.exec(smoke.component)?.[1];
    assert.ok(name);
    assert.match(smoke.component, new RegExp(`${name} = undefined as unknown as NgmWrite<typeof CardComponent, CardComponent, "title">`));
    assert.doesNotMatch(smoke.component, /\[elevation\]/);
  });

  it('writes selector attributes bare, the way users do', () => {
    assert.match(smoke.component, /<div libToggle><\/div>/);
  });

  it('binds an input that strictly requires boolean rather than writing it bare', () => {
    const custom = renderSmoke(
      {
        entries: ['lib'],
        declarables: [
          {
            id: 'd99',
            kind: 'directive',
            className: 'CollapseDirective',
            exportName: 'CollapseDirective',
            entry: 'lib',
            selector: '[collapse]',
            standalone: true,
            inputs: [{ property: 'collapse', alias: 'collapse', required: false, accessible: true, bare: false }],
            typeParams: 0,
          },
        ],
        pipes: [],
        modules: [],
        services: [],
      },
      { signalWriteBrand: true },
    );
    assert.match(custom.component, /<div \[collapse\]="v\d+"><\/div>/);
    assert.doesNotMatch(custom.component, /<div collapse><\/div>/);
  });

  it('uses components an NgModule exports, typed as any when they are not public', () => {
    assert.match(smoke.component, /<lib-badge \[label\]="v0"><\/lib-badge>/);
    assert.match(smoke.component, /v0 = undefined as unknown as any;/);
  });

  it('fills generic type parameters', () => {
    assert.match(smoke.component, /NgmWrite<typeof ListComponent, ListComponent<any>, "items">/);
  });

  it('skips non-standalone declarables nothing exports', () => {
    assert.doesNotMatch(smoke.component, /lib-unused/);
  });

  it("passes a pipe's required arguments", () => {
    assert.match(smoke.component, /\{\{ pipeValue \| format : pipeArg : pipeArg \}\}/);
  });

  it('injects services and pulls in every entry point', () => {
    assert.match(smoke.component, /inject<CardService>\(CardService, \{ optional: true \}\)/);
    assert.match(smoke.component, /import \* as ngmEntry1 from "lib\/testing";/);
    assert.match(smoke.component, /ngmEntries = \[ngmEntry0, ngmEntry1\]/);
  });

  it('works without the signal write brand, for Angular before 17.1', () => {
    const old = renderSmoke(api, { signalWriteBrand: false });
    assert.doesNotMatch(old.component, /ɵINPUT_SIGNAL_BRAND_WRITE_TYPE/);
  });

  it('counts what it used', () => {
    assert.deepEqual(smoke.counts, { components: 3, directives: 2, pipes: 1, modules: 1, services: 1 });
  });

  // Regression: ngx-toastr exports ToastBase and Toast, both with the selector [toast-component].
  // In one template they both match the same element, which Angular 22 reports as NG8023.
  it('never puts two exports with the same selector in one template', () => {
    const same = (id: string, className: string): Declarable => ({
      id,
      kind: 'component',
      className,
      exportName: className,
      entry: 'lib',
      selector: '[toast-component]',
      standalone: true,
      inputs: [],
      typeParams: 0,
    });
    const toastr = renderSmoke(
      { entries: ['lib'], declarables: [same('a', 'ToastBase'), same('b', 'Toast')], pipes: [], modules: [], services: [] },
      { signalWriteBrand: true },
    );
    const templates = [...toastr.component.matchAll(/template: `([^`]*)`/g)].map((m) => m[1]);
    assert.equal(templates.filter((t) => t.includes('toast-component')).length, 2);
    for (const template of templates) assert.ok((template.match(/toast-component/g) ?? []).length <= 1);
  });
});

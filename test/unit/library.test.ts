import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { detectBuild, fullCompilationEvidence, ngPackageDest } from '../../src/library.ts';

const root = mkdtempSync(join(tmpdir(), 'ngm-unit-'));
after(() => rmSync(root, { recursive: true, force: true }));

function dir(name: string, files: Record<string, string>): string {
  const base = join(root, name);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(base, file, '..'), { recursive: true });
    writeFileSync(join(base, file), text);
  }
  return base;
}

describe('full compilation', () => {
  it("is spotted by ng-packagr's prepublishOnly guard", () => {
    const pkg = dir('guard', {
      'package.json': JSON.stringify({
        name: 'x',
        scripts: { prepublishOnly: `node --eval "console.error('ERROR: Trying to publish a package that has been compiled by Ivy in full compilation mode.')"` },
      }),
    });
    assert.match(fullCompilationEvidence(pkg)!, /prepublishOnly/);
  });

  it('is spotted by ɵɵdefineComponent in the code', () => {
    const pkg = dir('define', {
      'package.json': '{"name":"x"}',
      'fesm2022/x.mjs': 'static ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: X });',
    });
    assert.match(fullCompilationEvidence(pkg)!, /ɵɵdefineComponent/);
  });

  it('leaves partial output alone', () => {
    const pkg = dir('partial', {
      'package.json': '{"name":"x"}',
      'fesm2022/x.mjs': 'static ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "14.0.0", version: "22.2.3" });',
    });
    assert.equal(fullCompilationEvidence(pkg), undefined);
  });
});

describe('finding the build', () => {
  it("takes dest from ng-package.json, relative to it, defaulting to dist", () => {
    const lib = dir('dest', { 'ng-package.json': '{"dest":"../../dist/my-lib"}', 'other/ng-package.json': '{}' });
    assert.equal(ngPackageDest(join(lib, 'ng-package.json')), resolve(lib, '../../dist/my-lib'));
    assert.equal(ngPackageDest(join(lib, 'other', 'ng-package.json')), resolve(lib, 'other', 'dist'));
  });

  it('uses the library project of an Angular CLI workspace', () => {
    const ws = dir('workspace', {
      'angular.json': JSON.stringify({
        version: 1,
        projects: {
          app: { projectType: 'application', root: '' },
          'my-lib': { projectType: 'library', root: 'projects/my-lib', architect: { build: { options: { project: 'projects/my-lib/ng-package.json' } } } },
        },
      }),
      'projects/my-lib/ng-package.json': '{"dest":"../../dist/my-lib"}',
    });
    const plan = detectBuild({ cwd: ws });
    assert.equal(plan.kind, 'angular-cli');
    assert.equal(plan.label, 'ng build my-lib --configuration production');
    assert.equal(plan.dest, resolve(ws, 'dist/my-lib'));
  });

  it('asks for --project when a workspace has several libraries', () => {
    const ws = dir('two-libs', {
      'angular.json': JSON.stringify({ version: 1, projects: { a: { projectType: 'library' }, b: { projectType: 'library' } } }),
    });
    assert.throws(() => detectBuild({ cwd: ws }), /Pick one with --project/);
  });

  it("runs a standalone ng-packagr library's build script", () => {
    const lib = dir('standalone', { 'ng-package.json': '{}', 'package.json': '{"name":"x","scripts":{"build":"ng-packagr -p ng-package.json"}}' });
    const plan = detectBuild({ cwd: lib });
    assert.equal(plan.kind, 'ng-packagr');
    assert.equal(plan.label, 'npm run build');
  });

  it('points Nx workspaces at v0.2', () => {
    const ws = dir('nx', { 'nx.json': '{}' });
    assert.throws(() => detectBuild({ cwd: ws }), /Nx workspaces are planned for v0\.2/);
  });
});

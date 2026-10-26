import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseNpmLs, pnpmWorkspaceYaml } from '../../src/install.ts';

// `npm ls --all` after installing Angular Material 22 into an Angular 21 app with --legacy-peer-deps.
const npmLs = `app21@0.0.0 C:\\Temp\\app21
+-- @angular/build@21.2.28
| \`-- @angular/core@21.2.25 deduped
+-- @angular/cdk@22.2.3
| +-- @angular/common@21.2.25 deduped invalid: "^22.0.0 || ^23.0.0" from node_modules/@angular/cdk
| \`-- @angular/core@21.2.25 deduped invalid: "^22.0.0 || ^23.0.0" from node_modules/@angular/cdk
+-- @angular/common@21.2.25 invalid: "^22.0.0 || ^23.0.0" from node_modules/@angular/cdk
+-- @angular/material@22.2.3
| \`-- @angular/core@21.2.25 deduped invalid: "^22.0.0 || ^23.0.0" from node_modules/@angular/material
+-- UNMET OPTIONAL DEPENDENCY vitest@^4.0.0
\`-- UNMET PEER DEPENDENCY @angular/animations@22.2.3
`;

describe('npm ls', () => {
  const problems = parseNpmLs(npmLs);

  it('finds invalid peers and who wants them', () => {
    const invalid = problems.filter((p) => p.installed);
    assert.equal(invalid.length, 4);
    assert.deepEqual(
      { name: invalid[0].name, installed: invalid[0].installed, wanted: invalid[0].wanted, by: invalid[0].by },
      { name: '@angular/common', installed: '21.2.25', wanted: '^22.0.0 || ^23.0.0', by: '@angular/cdk' },
    );
    assert.equal(invalid[3].by, '@angular/material');
  });

  it('reports unmet peers but not unmet optional dependencies', () => {
    const unmet = problems.filter((p) => !p.installed);
    assert.deepEqual(unmet.map((p) => p.name), ['@angular/animations']);
  });
});

describe('pnpm settings', () => {
  it('is strict about peers, and lets only the Angular toolchain run install scripts', () => {
    const yaml = pnpmWorkspaceYaml({});
    assert.match(yaml, /^strictPeerDependencies: true$/m);
    assert.match(yaml, /^strictDepBuilds: false$/m);
    assert.match(yaml, /^allowBuilds:\n {2}"@parcel\/watcher": true\n {2}"esbuild": true\n {2}"lmdb": true\n {2}"msgpackr-extract": true$/m);
    assert.doesNotMatch(yaml, /dangerouslyAllowAllBuilds|@file:/);
    assert.doesNotMatch(yaml, /peerDependencyRules/);
  });

  it('lets every install script run with --allow-scripts', () => {
    const yaml = pnpmWorkspaceYaml({}, true);
    assert.match(yaml, /^dangerouslyAllowAllBuilds: true$/m);
    assert.doesNotMatch(yaml, /allowBuilds:/);
  });

  it('allows only the expected conflict, scoped to the package', () => {
    const yaml = pnpmWorkspaceYaml({ 'my-lib>@angular/core': '22' });
    assert.match(yaml, /peerDependencyRules:\n {2}allowedVersions:\n {4}"my-lib>@angular\/core": "22"/);
  });
});

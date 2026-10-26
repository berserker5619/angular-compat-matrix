import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pickPeerVersion, planPeers } from '../../src/peers.ts';
import { Registry } from '../../src/registry.ts';

const registry = new Registry({ cacheDir: '', recordedDir: join(import.meta.dirname, '..', 'recorded') });
const cdk = await registry.get('@angular/cdk');

describe('peer range', () => {
  it('claims a version when every @angular/* peer allows it', async () => {
    const plan = await planPeers(
      { name: 'lib', version: '1.0.0', peerDependencies: { '@angular/core': '^21.0.0 || ^22.0.0', '@angular/common': '^21.0.0 || ^22.0.0', rxjs: '^7.4.0' } },
      '22.2.3',
      registry,
    );
    assert.equal(plan.claimed, true);
    assert.deepEqual(plan.installs, { '@angular/core': '22.2.3', '@angular/common': '22.2.3' });
  });

  it('checks non-core peers too: a CDK range can leave a version out', async () => {
    const plan = await planPeers(
      { name: 'lib', version: '1.0.0', peerDependencies: { '@angular/core': '^21.0.0 || ^22.0.0', '@angular/cdk': '^22.0.0' } },
      '21.2.25',
      registry,
    );
    assert.equal(plan.claimed, false);
    assert.deepEqual(plan.misses.map((m) => m.name), ['@angular/cdk']);
    // An Angular 21 app would use CDK 21, so that's what gets installed.
    assert.match(plan.installs['@angular/cdk'], /^21\./);
  });

  it('has nothing to claim without an @angular/* peer', async () => {
    const plan = await planPeers({ name: 'lib', version: '1.0.0', peerDependencies: {} }, '22.2.3', registry);
    assert.equal(plan.claimed, null);
  });

  // Regression: angular-calendar's date-fns adapter (an entry point the smoke app imports) needs
  // date-fns, an optional peer. Skipping optional peers failed every build with "Could not resolve".
  it('installs optional peers, but they claim nothing', async () => {
    const plan = await planPeers(
      {
        name: 'lib',
        version: '1.0.0',
        peerDependencies: { '@angular/core': '^22.0.0', '@angular/cdk': '^22.0.0' },
        peerDependenciesMeta: { '@angular/cdk': { optional: true } },
      },
      '22.2.3',
      registry,
    );
    assert.deepEqual(Object.keys(plan.installs), ['@angular/core', '@angular/cdk']);
    assert.match(plan.installs['@angular/cdk'], /^22\./);
    assert.equal(plan.claimed, true);
    assert.deepEqual(Object.keys(plan.checked), ['@angular/core']);
  });
});

describe('picking a peer version', () => {
  it('takes the newest CDK that accepts the Angular version and the library range', () => {
    assert.match(pickPeerVersion(cdk, '^21.0.0 || ^22.0.0', '21.2.25')!, /^21\.2\.\d+$/);
    assert.match(pickPeerVersion(cdk, '^21.0.0 || ^22.0.0', '22.2.3')!, /^22\.\d+\.\d+$/);
  });

  it('falls back to what the Angular version needs when the library range allows nothing', () => {
    assert.match(pickPeerVersion(cdk, '^22.0.0', '20.3.34')!, /^20\./);
  });
});

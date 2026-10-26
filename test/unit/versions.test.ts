import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Registry } from '../../src/registry.ts';
import {
  defaultMajors,
  describeMajor,
  loadVersionSources,
  majorsOf,
  nextVersion,
  nodeSatisfies,
  parseVersionList,
  supportedMajors,
} from '../../src/versions.ts';

// Recorded on 26 October 2026: Angular 17 to 22 are out, `next` is 22.3.0-next.2.
const registry = new Registry({ cacheDir: '', recordedDir: join(import.meta.dirname, '..', 'recorded') });
const now = new Date('2026-10-26T00:00:00Z');
const sources = await loadVersionSources(registry);

describe('which majors', () => {
  it('lists every published major', () => {
    assert.deepEqual(majorsOf(sources.core), [17, 18, 19, 20, 21, 22]);
  });

  it('counts a major as supported for 18 months after x.0.0', () => {
    // 19.0.0 shipped in November 2024, so its support ended in May 2026; 20.0.0 shipped in May 2025.
    assert.deepEqual(supportedMajors(sources.core, now), [20, 21, 22]);
    assert.deepEqual(supportedMajors(sources.core, new Date('2027-01-01T00:00:00Z')), [21, 22]);
  });

  it('labels `next` as it is, a minor pre-release here', () => {
    assert.equal(nextVersion(sources.core), '22.3.0-next.2');
  });

  it('defaults to the supported majors, every claimed major from 17 on, and the newest', () => {
    assert.deepEqual(defaultMajors(sources.core, '^21.0.0 || ^22.0.0', now), [20, 21, 22]);
    assert.deepEqual(defaultMajors(sources.core, '>=18.0.0', now), [18, 19, 20, 21, 22]);
    assert.deepEqual(defaultMajors(sources.core, '>=14.0.0', now), [17, 18, 19, 20, 21, 22]);
    assert.deepEqual(defaultMajors(sources.core, undefined, now), [20, 21, 22]);
  });
});

describe('per-major data', () => {
  it('reads TypeScript from @angular/compiler-cli, not @angular/core', () => {
    assert.equal(describeMajor(sources, 21, now).typescriptRange, '>=5.9 <6.1');
    assert.equal(describeMajor(sources, 22, now).typescriptRange, '>=6.0 <6.1');
    assert.equal(describeMajor(sources, 17, now).typescriptRange, '>=5.2 <5.5');
  });

  it("uses the CLI's own latest patch, which can differ from core's", () => {
    const angular = describeMajor(sources, 21, now);
    assert.equal(angular.version, '21.2.25');
    assert.match(angular.cliVersion, /^21\.2\.\d+$/);
  });

  it('reads Node from both engines fields, as minimums', () => {
    const v22 = describeMajor(sources, 22, now);
    assert.ok(v22.nodeRanges.length >= 1);
    assert.ok(nodeSatisfies('v24.19.0', v22.nodeRanges));
    assert.ok(!nodeSatisfies('v20.19.0', v22.nodeRanges));
    // One Node covers 17 to 22: the ranges have no upper bound.
    for (const major of [17, 18, 19, 20, 21, 22]) {
      assert.ok(nodeSatisfies('v24.15.0', describeMajor(sources, major, now).nodeRanges), `Angular ${major}`);
    }
  });

  it('describes a `next` pre-release', () => {
    const next = describeMajor(sources, 22, now, '22.3.0-next.2');
    assert.equal(next.version, '22.3.0-next.2');
    assert.ok(next.prerelease);
  });
});

describe('--versions', () => {
  it('takes majors, ranges and lists', () => {
    assert.deepEqual(parseVersionList('22'), [22]);
    assert.deepEqual(parseVersionList('18-20'), [18, 19, 20]);
    assert.deepEqual(parseVersionList('22,18-19'), [18, 19, 22]);
    assert.throws(() => parseVersionList('latest'), /isn't a major/);
  });
});

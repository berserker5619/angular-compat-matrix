// Records trimmed registry answers into test/recorded/, so unit tests don't depend on the
// network or on Angular releasing. Re-run after a new Angular major and update the tests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import { type Packument, trim } from '../src/registry.ts';

const out = join(import.meta.dirname, '..', 'test', 'recorded');
const keep: Record<string, (version: string) => boolean> = {
  '@angular/core': (v) => semver.major(v) >= 17,
  '@angular/cli': (v) => semver.major(v) >= 17,
  '@angular/compiler-cli': (v) => semver.major(v) >= 17,
  '@angular/cdk': (v) => semver.major(v) >= 17,
};

mkdirSync(out, { recursive: true });
for (const [name, filter] of Object.entries(keep)) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const full = trim((await response.json()) as Packument);
  const versions = Object.fromEntries(Object.entries(full.versions).filter(([v]) => semver.valid(v) && filter(v)));
  const time = Object.fromEntries(Object.entries(full.time).filter(([v]) => v in versions));
  const tags = Object.fromEntries(Object.entries(full['dist-tags']).filter(([, v]) => v in versions));
  const packument: Packument = { name, 'dist-tags': tags, versions, time };
  writeFileSync(join(out, `${encodeURIComponent(name)}.json`), JSON.stringify(packument, null, 1) + '\n');
  console.log(`${name}: ${Object.keys(versions).length} versions`);
}
writeFileSync(join(out, 'RECORDED_AT'), new Date().toISOString() + '\n');

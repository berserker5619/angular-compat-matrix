// Adds the postinstall to the built package; ng-packagr publishes no scripts of its own.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(import.meta.dirname, 'dist');
copyFileSync(join(import.meta.dirname, 'canary.cjs'), join(dist, 'canary.cjs'));
const manifest = JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8'));
manifest.scripts = { ...(manifest.scripts ?? {}), postinstall: 'node canary.cjs' };
writeFileSync(join(dist, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');

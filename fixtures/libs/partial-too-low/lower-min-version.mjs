// Angular 22 emits `ɵɵngDeclareFactory({ minVersion: "12.0.0", ..., target: ɵɵFactoryTarget.Service })`:
// the factory claims any linker from 12 on can read it, but FactoryTarget.Service only exists in 22.
// Here the companion ɵɵngDeclareService is lowered the same way, so nothing in the package admits it
// needs Angular 22. That's the case where Partial can only be advisory and the build has to decide.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, 'dist', 'fesm2022');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs'))) {
  const path = join(dir, file);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(/minVersion: "\d+\.\d+\.\d+"/g, 'minVersion: "12.0.0"');
  if (after !== before) writeFileSync(path, after);
}

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, 'dist', 'fesm2022');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs'))) {
  const path = join(dir, file);
  const content = readFileSync(path, 'utf8');
  const injected = `import { cloneDeep } from 'lodash';\nvoid cloneDeep;\n` + content;
  writeFileSync(path, injected);
}

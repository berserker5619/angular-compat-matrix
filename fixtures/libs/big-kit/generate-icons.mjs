// Writes ~1.4 MB of SVG path data, like a full icon set, so a smoke app that imports
// the kit is over Angular's default 1 MB production budget.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

let seed = 1;
const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const point = () => `${(next() * 24).toFixed(3)} ${(next() * 24).toFixed(3)}`;
const lines = [];
for (let i = 0; i < 1800; i++) {
  const path = Array.from({ length: 60 }, () => `L${point()}`).join('');
  lines.push(`  'icon-${i}': 'M${point()}${path}Z',`);
}
writeFileSync(
  join(import.meta.dirname, 'src', 'icons.generated.ts'),
  `export const ICONS: Record<string, string> = {\n${lines.join('\n')}\n};\n`,
);

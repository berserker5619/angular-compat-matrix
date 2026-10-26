import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { skippedByNpm, skippedByPnpm } from '../../src/scripts.ts';

describe('install scripts the default skipped', () => {
  it('reads them from npm\'s lockfile, leaving out the toolchain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ngm-scripts-'));
    try {
      writeFileSync(
        join(dir, 'package-lock.json'),
        JSON.stringify({
          packages: {
            '': { name: 'smoke', hasInstallScript: true },
            'node_modules/esbuild': { version: '0.25.0', hasInstallScript: true },
            'node_modules/@parcel/watcher': { version: '2.5.1', hasInstallScript: true },
            'node_modules/core-js': { version: '3.46.0', hasInstallScript: true },
            'node_modules/some-lib/node_modules/@scope/native': { version: '1.0.0', hasInstallScript: true },
            'node_modules/rxjs': { version: '7.8.2' },
          },
        }),
      );
      mkdirSync(join(dir, 'node_modules/core-js'), { recursive: true });
      writeFileSync(join(dir, 'node_modules/core-js/package.json'), '{}');
      mkdirSync(join(dir, 'node_modules/some-lib/node_modules/@scope/native'), { recursive: true });
      writeFileSync(join(dir, 'node_modules/some-lib/node_modules/@scope/native/package.json'), '{}');
      assert.deepEqual(skippedByNpm(dir), ['@scope/native@1.0.0', 'core-js@3.46.0']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is empty without a lockfile', () => {
    assert.deepEqual(skippedByNpm(join(tmpdir(), 'ngm-no-such-dir')), []);
  });

  it('reads them from pnpm\'s own message', () => {
    const output = [
      '.../esbuild@0.25.0/node_modules/esbuild postinstall: Done',
      'Ignored build scripts: core-js@3.46.0, sharp@0.34.1.',
      'Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.',
    ].join('\r\n');
    assert.deepEqual(skippedByPnpm(output), ['core-js@3.46.0', 'sharp@0.34.1']);
    assert.deepEqual(skippedByPnpm('Done in 3.7s'), []);
  });
});

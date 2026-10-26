// Disk full: with its temp folder and cache on a small filesystem, a run must stop with a clear
// message (exit 2, the version marked not checked), leave no half-written cache entries, and the
// next run with room to spare must work with the same cache.
//
//   SMALL_DISK=/mnt/small node test/robustness/disk-full.ts   (CI mounts a 150 MB tmpfs there)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isComplete } from '../../src/tools.ts';

const small = process.env.SMALL_DISK;
if (!small) throw new Error('Set SMALL_DISK to a small, writable filesystem.');
const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'dist', 'cli.js');
const cache = join(small, 'cache');
const tmp = join(small, 'tmp');
mkdirSync(cache, { recursive: true });
mkdirSync(tmp, { recursive: true });

function run(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, '--package', 'ngx-toastr@20.0.5', '--versions', '22', '--format', 'json'], {
      cwd: root,
      env: { ...process.env, NG_MATRIX_CACHE: cache, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d));
    child.stderr.on('data', (d: Buffer) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function assertCacheIntact(): void {
  for (const sub of ['registry', 'tools']) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(cache, sub));
    } catch {
      continue;
    }
    for (const name of entries) {
      assert.ok(!name.endsWith('.tmp'), `half-written cache entry left: ${sub}/${name}`);
      if (sub === 'registry') JSON.parse(readFileSync(join(cache, sub, name), 'utf8'));
      if (sub === 'tools' && !name.startsWith('pnpm-shim')) {
        const pkg = name.replace(/@[^@]+$/, '').replace('+', '/');
        assert.ok(isComplete(join(cache, sub, name, 'node_modules', ...pkg.split('/'))), `incomplete tool in the cache: ${name}`);
      }
    }
  }
}

// 1. Temp folder and cache on the small disk: the install (or the CLI download) runs out of space.
const full = await run({ TMPDIR: tmp, TEMP: tmp, TMP: tmp });
assert.equal(full.code, 2, `exit code on a full disk\n${full.stderr}`);
const text = full.stdout.trim() ? JSON.stringify(JSON.parse(full.stdout).versions[0].setupError) : full.stderr;
assert.match(text, /disk is full/, `the message says the disk is full:\n${text}`);
assertCacheIntact();
console.log(`✓ full disk: exit 2, "${text.split('\\n')[0].slice(0, 120)}…"`);

// 2. Same cache, temp folder back on the big disk: the run works.
const roomy = await run({});
assert.equal(roomy.code, 0, `the run after the full disk\n${roomy.stderr}`);
assert.equal(JSON.parse(roomy.stdout).versions[0].checks.aot.status, 'pass');
assertCacheIntact();
console.log('✓ the next run, with room, works with the same cache');

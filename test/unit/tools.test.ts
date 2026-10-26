import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { pnpmShimDir, withPath } from '../../src/tools.ts';

const root = mkdtempSync(join(tmpdir(), 'ngm-tools-'));
after(() => rmSync(root, { recursive: true, force: true }));

// Regression: `--tests --pm pnpm` ran `pnpm test` in a shell where pnpm wasn't on PATH,
// so every version's tests "failed" with "'pnpm' is not recognized".
describe('the pnpm shim for test commands', () => {
  // A stand-in for the cached pnpm package: bin/pnpm.mjs prints its arguments.
  const pkgDir = join(root, 'pnpm');
  mkdirSync(join(pkgDir, 'bin'), { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), '{"name":"pnpm","bin":{"pnpm":"bin/pnpm.mjs"}}');
  writeFileSync(join(pkgDir, 'bin', 'pnpm.mjs'), 'console.log("fake pnpm", process.argv.slice(2).join(" "));');
  const dir = pnpmShimDir(join(root, 'cache'), pkgDir);

  it('writes a shim for sh and for cmd.exe', () => {
    assert.ok(existsSync(join(dir, 'pnpm')));
    assert.match(readFileSync(join(dir, 'pnpm.cmd'), 'utf8'), /pnpm\.mjs" %\*/);
  });

  it('puts the shim first on PATH, whatever the key is called', () => {
    assert.ok(withPath({ PATH: '/usr/bin' }, dir).PATH!.startsWith(dir + delimiter));
    const windows = withPath({ Path: 'C:\\Windows' }, dir);
    assert.ok(windows.Path!.startsWith(dir + delimiter));
    assert.equal(windows.PATH, undefined);
  });

  it('lets a shell command named pnpm reach the cached pnpm', () => {
    const output = execFileSync('pnpm test', { shell: true, env: withPath(process.env, dir), encoding: 'utf8' });
    assert.match(output, /fake pnpm test/);
  });
});

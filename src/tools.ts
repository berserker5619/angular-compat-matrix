import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { errorLines, npm } from './exec.ts';

/** The pnpm ng-matrix uses, pinned so its peer and build-script rules don't shift under it. */
export const PNPM_VERSION = '12.15.0';

export function defaultCacheDir(): string {
  if (process.env.NG_MATRIX_CACHE) return process.env.NG_MATRIX_CACHE;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'ng-matrix', 'Cache');
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ng-matrix');
}

const pending = new Map<string, Promise<string>>();

/**
 * Installs one npm package into the cache once (say, `@angular/cli@21.2.28`) and returns its folder,
 * so each Angular major's CLI and the pinned pnpm are downloaded once, not on every run.
 */
export function ensureTool(cacheDir: string, name: string, version: string, offline = false): Promise<string> {
  const key = `${name}@${version}`;
  let promise = pending.get(key);
  if (!promise) {
    promise = install(cacheDir, name, version, offline);
    pending.set(key, promise);
  }
  return promise;
}

async function install(cacheDir: string, name: string, version: string, offline: boolean): Promise<string> {
  const home = join(cacheDir, 'tools', `${name.replace('/', '+')}@${version}`);
  const pkgDir = join(home, 'node_modules', ...name.split('/'));
  if (existsSync(join(pkgDir, 'package.json'))) return pkgDir;
  const tmp = `${home}.${process.pid}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const args = ['install', `${name}@${version}`, '--prefix', tmp, '--no-save', '--no-package-lock', '--ignore-scripts'];
  if (offline) args.push('--offline');
  const result = await npm(args, { cwd: tmp });
  if (result.code !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`Couldn't download ${name}@${version}:\n${errorLines(result.output).join('\n')}`);
  }
  mkdirSync(dirname(home), { recursive: true });
  try {
    renameSync(tmp, home);
  } catch {
    // Another ng-matrix process got there first; theirs is as good as ours.
    rmSync(tmp, { recursive: true, force: true });
  }
  return pkgDir;
}

export function binOf(pkgDir: string, bin: string): string {
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
  const path = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[bin];
  if (!path) throw new Error(`${pkgDir} has no "${bin}" command.`);
  return join(pkgDir, path);
}

/**
 * pnpm 11+ is a native binary that an install script puts in place of the `pnpm` bin; tools are
 * installed with scripts off, so ng-matrix enters through `bin/pnpm.mjs`, as Corepack does, which
 * finds the binary in the `@pnpm/exe.<platform>` optional dependency.
 */
export function pnpmEntry(pkgDir: string): string {
  const entry = join(pkgDir, 'bin', 'pnpm.mjs');
  return existsSync(entry) ? entry : binOf(pkgDir, 'pnpm');
}

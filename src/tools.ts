import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { environmentProblem, errorLines, npm } from './exec.ts';

/** The pnpm ng-matrix uses, pinned so its peer and build-script rules don't shift under it. */
export const PNPM_VERSION = '12.15.0';

export function defaultCacheDir(): string {
  if (process.env.NG_MATRIX_CACHE) return process.env.NG_MATRIX_CACHE;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'ng-matrix', 'Cache');
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ng-matrix');
}

export function cacheStats(cacheDir: string): { bytes: number; count: number } {
  let bytes = 0;
  let count = 0;
  if (!existsSync(cacheDir)) return { bytes: 0, count: 0 };
  const stack = [cacheDir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          bytes += statSync(full).size;
          count++;
        } catch {
          // ignore transient access errors
        }
      }
    }
  }
  return { bytes, count };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes / 1024;
  for (const unit of units) {
    if (val < 1024 || unit === 'TB') {
      return `${val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${unit}`;
    }
    val /= 1024;
  }
  return `${bytes} B`;
}

export function cleanCache(cacheDir: string): void {
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5 });
  }
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
  if (isComplete(pkgDir)) return pkgDir;
  // A damaged entry (a truncated package.json, a missing bin) is downloaded again.
  if (existsSync(home)) rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  const tmp = `${home}.${process.pid}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const args = ['install', `${name}@${version}`, '--prefix', tmp, '--no-save', '--no-package-lock', '--ignore-scripts'];
  if (offline) args.push('--offline');
  const result = await npm(args, { cwd: tmp });
  if (result.code !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    const why = environmentProblem(result);
    throw new Error(`Couldn't download ${name}@${version}${why ? `: ${why}` : ''}:\n${errorLines(result.output).join('\n')}`);
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

/** A cached tool is usable when its package.json parses and every bin it declares is there. */
export function isComplete(pkgDir: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
    const bins = typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {});
    return bins.every((bin) => existsSync(join(pkgDir, bin)));
  } catch {
    return false;
  }
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

/**
 * A folder with `pnpm` (and `pnpm.cmd` on Windows) that runs the cached pnpm, for PATH, so an
 * author's test command (`pnpm test`, or a script that calls pnpm) finds the same pnpm.
 */
export function pnpmShimDir(cacheDir: string, pkgDir: string): string {
  const dir = join(cacheDir, 'tools', `pnpm-shim@${PNPM_VERSION}`);
  mkdirSync(dir, { recursive: true });
  const entry = pnpmEntry(pkgDir);
  writeFileSync(join(dir, 'pnpm'), `#!/bin/sh\nexec "${process.execPath}" "${entry}" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'pnpm.cmd'), `@"${process.execPath}" "${entry}" %*\r\n`);
  return dir;
}

/** PATH with `dir` first, under whichever spelling of the key this platform uses. */
export function withPath(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  return { ...env, [key]: `${dir}${delimiter}${env[key] ?? ''}` };
}

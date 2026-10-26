import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ExecOptions, type ExecResult, npm } from './exec.ts';

/*
 * Install scripts run arbitrary code on the machine. By default ng-matrix runs only the ones the
 * Angular toolchain itself needs: every package with an install script in a fresh Angular 17 to 22
 * app is on this list. The package under test and its dependencies run none, unless --allow-scripts.
 */
export const TOOLCHAIN_BUILDS = ['@parcel/watcher', 'esbuild', 'lmdb', 'msgpackr-extract'];

/**
 * In the toolchain's tree with an install script that isn't needed, so it stays off and isn't
 * reported: fsevents (macOS only) ships a prebuilt binary; its script would rebuild it with node-gyp.
 */
const TOOLCHAIN_UNNEEDED = ['fsevents'];

export const ALLOW_SCRIPTS_WARNING =
  '--allow-scripts: install scripts of the package under test and all of its dependencies will run on this machine.';

/**
 * `npm install` with scripts off, then `npm rebuild` of just the toolchain packages: npm has no
 * allow-list that works on both npm 10 and 11, but this does.
 */
export async function npmInstall(args: string[], options: ExecOptions, allowScripts: boolean): Promise<ExecResult> {
  if (allowScripts) return npm(args, options);
  const installed = await npm([...args, '--ignore-scripts'], options);
  if (installed.code !== 0) return installed;
  const present = TOOLCHAIN_BUILDS.filter((name) => existsSync(join(options.cwd, 'node_modules', ...name.split('/'), 'package.json')));
  if (!present.length) return installed;
  const rebuilt = await npm(['rebuild', ...present], options);
  return {
    code: rebuilt.code,
    output: `${installed.output}\n${rebuilt.output}`,
    durationMs: installed.durationMs + rebuilt.durationMs,
    timedOut: rebuilt.timedOut,
  };
}

/** pnpm-workspace.yaml lines: builds allowed for the toolchain only, or for everything. */
export function pnpmBuildSettings(allowScripts: boolean): string[] {
  if (allowScripts) return ['strictDepBuilds: false', 'dangerouslyAllowAllBuilds: true'];
  return ['strictDepBuilds: false', 'allowBuilds:', ...TOOLCHAIN_BUILDS.map((name) => `  ${JSON.stringify(name)}: true`)];
}

/** `name@version` of every installed package whose install script npm didn't run: its lockfile marks them. */
export function skippedByNpm(appDir: string): string[] {
  let lock: { packages?: Record<string, { version?: string; hasInstallScript?: boolean }> };
  try {
    lock = JSON.parse(readFileSync(join(appDir, 'package-lock.json'), 'utf8'));
  } catch {
    return [];
  }
  const skipped = new Set<string>();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry.hasInstallScript || !path.includes('node_modules/')) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (TOOLCHAIN_BUILDS.includes(name) || TOOLCHAIN_UNNEEDED.includes(name)) continue;
    // The lockfile lists every platform's optional packages; only what's on disk counts.
    if (!existsSync(join(appDir, path, 'package.json'))) continue;
    skipped.add(entry.version ? `${name}@${entry.version}` : name);
  }
  return [...skipped].sort();
}

/** pnpm says so itself: `Ignored build scripts: core-js@3.46.0, sharp@0.34.1.` */
export function skippedByPnpm(output: string): string[] {
  const line = /Ignored build scripts:\s*(.+?)\.?\s*$/m.exec(output);
  if (!line) return [];
  const names = line[1].split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(names.filter((spec) => !TOOLCHAIN_UNNEEDED.includes(spec.replace(/(.)@[^@]*$/, '$1'))))].sort();
}

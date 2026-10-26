import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type ExecOptions, type ExecResult, npm } from './exec.ts';

/*
 * Install scripts run arbitrary code on the machine. By default ng-matrix runs only the ones the
 * Angular toolchain itself needs: every package with an install script in a fresh Angular 17 to 22
 * app is on this list. The package under test and its dependencies run none, unless --allow-scripts.
 */
export const TOOLCHAIN_BUILDS = ['@parcel/watcher', 'esbuild', 'lmdb', 'msgpackr-extract'];

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

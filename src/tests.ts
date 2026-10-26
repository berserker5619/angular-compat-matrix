import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import semver from 'semver';
import { type PackageManager, readJson, writeJson } from './app.ts';
import { environmentProblem, errorLines, exec, npm, quietEnv, stepTimeout } from './exec.ts';
import { FRAMEWORK } from './peers.ts';
import type { Registry } from './registry.ts';
import { ensureTool, PNPM_VERSION, pnpmEntry, pnpmShimDir, withPath } from './tools.ts';
import type { AngularMajor } from './versions.ts';

/** Packages released with the Angular CLI, versioned with it. */
const TOOLING = /^(@angular\/(cli|build|ssr|pwa)|@angular-devkit\/.+|@schematics\/angular)$/;

const SKIP = new Set(['node_modules', '.git', '.angular', 'dist', '.nx', '.ng-matrix', 'coverage']);

export interface TestsRequest {
  workspace: string;
  into: string;
  angular: AngularMajor;
  /** Versions already chosen for the library's other peers (Material, CDK…) on this Angular. */
  peerVersions: Record<string, string>;
  pm: PackageManager;
  command?: string;
  registry: Registry;
  cacheDir: string;
  offline: boolean;
}

export interface TestsOutcome {
  pass: boolean;
  message: string;
  errorLines: string[];
  durationMs: number;
  /** The machine's fault (a timeout, a full disk, the network), not the tests'. */
  environment?: string;
}

/**
 * The version every Angular-related dependency of the workspace gets for this major:
 * framework packages match @angular/core, tooling matches the CLI, and TypeScript, zone.js,
 * RxJS and ng-packagr get the ranges this Angular accepts, for the package manager to resolve.
 */
export function swapVersions(
  deps: Record<string, string>,
  request: Pick<TestsRequest, 'angular' | 'peerVersions'>,
): Record<string, string> {
  const { angular, peerVersions } = request;
  const out: Record<string, string> = { ...deps };
  for (const name of Object.keys(deps)) {
    if (FRAMEWORK.has(name)) out[name] = angular.version;
    else if (TOOLING.test(name)) out[name] = angular.cliVersion;
    else if (peerVersions[name]) out[name] = peerVersions[name];
    else if (name === 'ng-packagr') out[name] = angular.prerelease ? `>=${angular.major}.0.0-0` : `^${angular.major}.0.0`;
    else if (name === 'typescript' && angular.typescriptRange) out[name] = angular.typescriptRange;
    else if (name === 'zone.js' && angular.zoneRange) out[name] = angular.zoneRange;
    else if (name === 'rxjs' && angular.rxjsRange) {
      const current = semver.minVersion(deps[name]);
      if (!current || !semver.satisfies(current, angular.rxjsRange)) out[name] = angular.rxjsRange;
    }
  }
  return out;
}

/** Runs the library's own tests in a copy of its workspace, with Angular swapped to this version. */
export async function runLibraryTests(request: TestsRequest): Promise<TestsOutcome> {
  const started = Date.now();
  rmSync(request.into, { recursive: true, force: true });
  cpSync(request.workspace, request.into, {
    recursive: true,
    filter: (source) => {
      const rel = relative(request.workspace, source);
      return !rel || !rel.split(sep).some((part) => SKIP.has(part));
    },
  });
  for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) rmSync(join(request.into, lock), { force: true });

  const manifestPath = join(request.into, 'package.json');
  const manifest = readJson<Record<string, unknown> & { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
    manifestPath,
  );
  if (manifest.dependencies) manifest.dependencies = swapVersions(manifest.dependencies, request);
  if (manifest.devDependencies) manifest.devDependencies = swapVersions(manifest.devDependencies, request);
  if (request.pm === 'pnpm') manifest.packageManager = `pnpm@${PNPM_VERSION}`;
  else delete manifest.packageManager;
  writeJson(manifestPath, manifest);

  let env = quietEnv({ CI: '1' });
  let install;
  if (request.pm === 'npm') {
    const args = ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'];
    if (request.offline) args.push('--offline');
    install = await npm(args, { cwd: request.into, env, timeoutMs: stepTimeout() });
  } else {
    writeFileSync(join(request.into, 'pnpm-workspace.yaml'), 'strictPeerDependencies: false\nstrictDepBuilds: false\n');
    const pnpm = await ensureTool(request.cacheDir, 'pnpm', PNPM_VERSION, request.offline);
    // The test command runs in a shell; it has to find this pnpm, not whatever is (or isn't) installed.
    env = withPath(env, pnpmShimDir(request.cacheDir, pnpm));
    install = await exec(process.execPath, [pnpmEntry(pnpm), 'install', '--no-frozen-lockfile'], {
      cwd: request.into,
      env,
      timeoutMs: stepTimeout(),
    });
  }
  if (install.code !== 0) {
    return {
      pass: false,
      message: `Installing the workspace with Angular ${request.angular.version} failed.`,
      errorLines: errorLines(install.output),
      durationMs: Date.now() - started,
      environment: environmentProblem(install),
    };
  }

  const command = request.command ?? `${request.pm} test`;
  const result = await exec(command, [], { cwd: request.into, env, shell: true, timeoutMs: stepTimeout() });
  const tail = result.output.split(/\r?\n/).filter((l) => l.trim()).slice(-8);
  return {
    pass: result.code === 0,
    message: result.code === 0 ? `\`${command}\` passed.` : `\`${command}\` exited with ${result.code}.`,
    errorLines: result.code === 0 ? tail.slice(-3) : errorLines(result.output),
    durationMs: Date.now() - started,
    environment: result.code === 0 ? undefined : environmentProblem(result),
  };
}

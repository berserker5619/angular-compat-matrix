import { copyFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import semver from 'semver';
import { type PackageManager, readJson, writeJson } from './app.ts';
import { environmentProblem, errorLines, exec, npm, quietEnv, stepTimeout } from './exec.ts';
import type { PeerPlan } from './peers.ts';
import { npmInstall, pnpmBuildSettings } from './scripts.ts';
import { ensureTool, PNPM_VERSION, pnpmEntry } from './tools.ts';

export interface InstallRequest {
  appDir: string;
  pm: PackageManager;
  libraryName: string;
  tarball: string;
  plan: PeerPlan;
  angularMajor: number;
  cacheDir: string;
  offline: boolean;
  /** Let every install script run, not just the Angular toolchain's (--allow-scripts). */
  allowScripts: boolean;
}

export interface InstallOutcome {
  pass: boolean;
  message: string;
  errorLines: string[];
  /** Peer conflicts that were expected (the version is outside the claimed range) and ignored. */
  ignored: string[];
  /** The machine's fault (a timeout, a full disk, the network), not the package's. */
  environment?: string;
}

export function addDependencies(appDir: string, deps: Record<string, string>, extra: Record<string, unknown> = {}): void {
  const path = join(appDir, 'package.json');
  const manifest = readJson<Record<string, unknown> & { dependencies?: Record<string, string> }>(path);
  manifest.dependencies = { ...(manifest.dependencies ?? {}), ...deps };
  Object.assign(manifest, extra);
  writeJson(path, manifest);
}

export async function installLibrary(request: InstallRequest): Promise<InstallOutcome> {
  const tgz = basename(request.tarball);
  copyFileSync(request.tarball, join(request.appDir, tgz));
  const deps = { ...request.plan.installs, [request.libraryName]: `file:${tgz}` };
  return request.pm === 'npm' ? installWithNpm(request, deps) : installWithPnpm(request, deps, tgz);
}

/**
 * npm 11 fails on any peer conflict and can't ignore just one. So: install without peer
 * resolution, with the peers added explicitly, then let `npm ls` report every invalid peer.
 */
async function installWithNpm(request: InstallRequest, deps: Record<string, string>): Promise<InstallOutcome> {
  addDependencies(request.appDir, deps);
  const args = ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'];
  if (request.offline) args.push('--offline');
  const result = await npmInstall(args, { cwd: request.appDir, timeoutMs: stepTimeout() }, request.allowScripts);
  if (result.code !== 0) {
    return { pass: false, message: 'npm install failed.', errorLines: errorLines(result.output), ignored: [], environment: environmentProblem(result) };
  }
  const ls = await npm(['ls', '--all'], { cwd: request.appDir });
  const problems = parseNpmLs(ls.output);
  return judgeProblems(request, problems);
}

export interface PeerProblem {
  /** The package installed at the wrong version, or missing. */
  name: string;
  installed?: string;
  wanted: string;
  /** Who wants it (`node_modules/<name>`), when npm says. */
  by?: string;
  line: string;
}

/** Reads `npm ls --all` text output: `@angular/core@21.2.25 deduped invalid: "^22.0.0" from node_modules/@angular/cdk`. */
export function parseNpmLs(output: string): PeerProblem[] {
  const problems: PeerProblem[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.replace(/^[\s|`+\\-]+/, '').trim();
    const invalid = /^(@?[^@\s]+)@(\S+)(?: deduped)? invalid: (.+)$/.exec(line);
    if (invalid) {
      for (const want of invalid[3].matchAll(/"([^"]+)" from (\S+?)(?:,|$)/g)) {
        problems.push({ name: invalid[1], installed: invalid[2], wanted: want[1], by: want[2].replace(/^.*node_modules\//, ''), line });
      }
      continue;
    }
    const unmet = /UNMET (?:OPTIONAL )?(?:PEER )?DEPENDENCY (@?[^@\s]+)@(\S+)/.exec(line);
    if (unmet && !/OPTIONAL/.test(line)) problems.push({ name: unmet[1], wanted: unmet[2], line });
  }
  return problems;
}

function judgeProblems(request: InstallRequest, problems: PeerProblem[]): InstallOutcome {
  // Only conflicts about the package under test and the peers installed for it count;
  // anything else in the tree is the generated app's own business.
  const ours = new Set([request.libraryName, ...Object.keys(request.plan.installs)]);
  const ourPeers = new Set([...Object.keys(request.plan.installs), ...Object.keys(request.plan.checked)]);
  const relevant = problems.filter((p) => (p.by ? ours.has(p.by) : ourPeers.has(p.name)));
  const outside = request.plan.claimed === false;
  const ignored = relevant.filter((p) => outside && p.name.startsWith('@angular/') && p.by === request.libraryName);
  const failing = relevant.filter((p) => !ignored.includes(p));
  const describe = (p: PeerProblem) =>
    `${p.by ?? '?'} wants ${p.name}@"${p.wanted}"${p.installed ? `, found ${p.installed}` : ', missing'}`;
  if (failing.length) {
    return {
      pass: false,
      message: `Peer conflict: ${describe(failing[0])}${failing.length > 1 ? ` (+${failing.length - 1} more)` : ''}.`,
      errorLines: failing.map((p) => p.line),
      ignored: ignored.map(describe),
    };
  }
  return {
    pass: true,
    message: ignored.length ? `Installed; ignored the expected conflict: ${ignored.map(describe).join('; ')}.` : 'Installed.',
    errorLines: [],
    ignored: ignored.map(describe),
  };
}

/**
 * pnpm only warns about peers by default, so strictPeerDependencies is on, with allowedVersions
 * for the one expected conflict. strictDepBuilds is off: otherwise pnpm 12 fails every install
 * on Angular's own esbuild, lmdb and @parcel/watcher scripts. The library's own scripts may run.
 */
async function installWithPnpm(request: InstallRequest, deps: Record<string, string>, tgz: string): Promise<InstallOutcome> {
  addDependencies(request.appDir, deps, { packageManager: `pnpm@${PNPM_VERSION}` });
  const allowed: Record<string, string> = {};
  if (request.plan.claimed === false) {
    for (const miss of request.plan.misses) {
      const major = semver.valid(miss.version) ? String(semver.major(miss.version)) : String(request.angularMajor);
      allowed[`${request.libraryName}>${miss.name}`] = major;
    }
  }
  writeFileSync(join(request.appDir, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml(allowed, request.allowScripts));
  const pnpm = await ensureTool(request.cacheDir, 'pnpm', PNPM_VERSION, request.offline);
  const args = [pnpmEntry(pnpm), 'install', '--no-frozen-lockfile'];
  if (request.offline) args.push('--offline');
  const result = await exec(process.execPath, args, { cwd: request.appDir, env: quietEnv(), timeoutMs: stepTimeout() });
  const ignored = Object.entries(allowed).map(([key, major]) => `${key} allowed at ${major}.x`);
  if (result.code !== 0) {
    const peer = /ERR_PNPM_PEER_DEP_ISSUES|unmet peer|Issues with peer dependencies/i.test(result.output);
    return {
      pass: false,
      message: peer ? 'Peer conflict (pnpm strict-peer-dependencies).' : 'pnpm install failed.',
      errorLines: errorLines(result.output),
      ignored,
      environment: environmentProblem(result),
    };
  }
  return {
    pass: true,
    message: ignored.length ? `Installed; allowed the expected conflict: ${ignored.join('; ')}.` : 'Installed.',
    errorLines: [],
    ignored,
  };
}

export function pnpmWorkspaceYaml(allowed: Record<string, string>, allowScripts = false): string {
  const lines = ['strictPeerDependencies: true', ...pnpmBuildSettings(allowScripts)];
  if (Object.keys(allowed).length) {
    lines.push('peerDependencyRules:', '  allowedVersions:');
    for (const [key, range] of Object.entries(allowed)) lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(range)}`);
  }
  return lines.join('\n') + '\n';
}

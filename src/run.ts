import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { freemem, availableParallelism } from 'node:os';
import { join, relative, sep } from 'node:path';
import { configureBuild, generateApp, type PackageManager, readJson, writeJson } from './app.ts';
import { findUndeclaredImports, isDtsOnlyFailure, ngBuild } from './build.ts';
import { installLibrary } from './install.ts';
import type { PackedLibrary } from './library.ts';
import { type CheckName, CHECKS, type CheckResult, result, type VersionReport } from './model.ts';
import { judgePartial, type PartialSummary } from './partial.ts';
import { planPeers } from './peers.ts';
import type { Registry } from './registry.ts';
import { entryPoints, hasSignalWriteBrand, type PublicApi, readPublicApi, renderSmoke, writeSmoke } from './smoke.ts';
import { runLibraryTests, swapVersions } from './tests.ts';
import type { AngularMajor } from './versions.ts';

export interface RunContext {
  library: PackedLibrary;
  summary: PartialSummary;
  pm: PackageManager;
  registry: Registry;
  cacheDir: string;
  offline: boolean;
  workDir: string;
  /** The author's workspace, for --tests; absent for --tarball and --package. */
  workspace?: string;
  tests: boolean;
  testCommand?: string;
  consumer?: string;
  keep: boolean;
  /** Let every install script run, not just the Angular toolchain's (--allow-scripts). */
  allowScripts: boolean;
  log: (line: string) => void;
}

/** About what one Angular production build needs; versions beyond what memory allows wait their turn. */
const MEMORY_PER_VERSION = 2.5 * 1024 ** 3;

export function defaultConcurrency(versions: number): number {
  const byMemory = Math.floor(freemem() / MEMORY_PER_VERSION);
  return Math.max(1, Math.min(versions, byMemory, availableParallelism()));
}

export async function runAll(ctx: RunContext, majors: AngularMajor[], concurrency: number): Promise<VersionReport[]> {
  const reports: VersionReport[] = new Array(majors.length);
  let next = 0;
  const worker = async () => {
    while (next < majors.length) {
      const index = next++;
      reports[index] = await checkVersion(ctx, majors[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, majors.length) }, worker));
  return reports;
}

function installedAngular(appDir: string, fallback: string): string {
  try {
    const require = createRequire(join(appDir, 'package.json'));
    return (JSON.parse(readFileSync(require.resolve('@angular/core/package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return fallback;
  }
}

export async function checkVersion(ctx: RunContext, angular: AngularMajor): Promise<VersionReport> {
  const started = Date.now();
  const tag = `Angular ${angular.major}`;
  const checks = Object.fromEntries(CHECKS.map((c) => [c, result('not-run')])) as Record<CheckName, CheckResult>;
  if (!ctx.tests) checks.tests = result('off', 'Not requested (--tests).');
  const report: VersionReport = {
    major: angular.major,
    angularVersion: angular.version,
    supported: angular.supported,
    prerelease: angular.prerelease,
    claimed: null,
    peerMisses: [],
    checks,
    durationMs: 0,
  };
  const finish = () => {
    report.durationMs = Date.now() - started;
    ctx.log(`${tag}: done in ${Math.round(report.durationMs / 1000)} s`);
    return report;
  };
  // A timeout, a full disk or a network error says nothing about the package: this version
  // wasn't checked (exit 2), rather than failing a check.
  const notChecked = (step: string, why: string, lines: string[]) => {
    report.setupError = [`${step} on ${tag}: ${why}.`, ...lines].join('\n');
    return finish();
  };

  // Peer range: reported, but never stops the other checks.
  const plan = await planPeers(ctx.library.manifest, angular.version, ctx.registry);
  report.claimed = plan.claimed;
  report.peerMisses = plan.misses;
  checks.peer =
    plan.claimed === null
      ? result('none', 'The package declares no @angular/* peer dependency.')
      : plan.claimed
        ? result('pass', `Claimed: ${Object.entries(plan.checked).map(([n, v]) => `${n}@${v}`).join(', ')}.`)
        : result('fail', plan.misses.map((m) => `${m.name} "${m.range}" doesn't allow ${m.version}`).join('; ') + '.');

  const versionDir = join(ctx.workDir, `angular-${angular.major}`);
  mkdirSync(versionDir, { recursive: true });
  let appDir: string;
  try {
    ctx.log(`${tag}: creating the app (${ctx.consumer ? 'your --consumer app' : `ng new, CLI ${angular.cliVersion}`})`);
    appDir = ctx.consumer
      ? await copyConsumer(ctx, angular, plan.installs, versionDir)
      : await generateApp(angular, ctx.pm, versionDir, ctx.cacheDir, ctx.offline);
    if (ctx.keep) report.appDir = appDir;
  } catch (error) {
    report.setupError = (error as Error).message;
    if (!ctx.keep) rmSync(versionDir, { recursive: true, force: true, maxRetries: 3 });
    return finish();
  }

  try {
    ctx.log(`${tag}: installing ${ctx.library.manifest.name} with ${ctx.pm}`);
    const installStarted = Date.now();
    const installed = await installLibrary({
      appDir,
      pm: ctx.pm,
      libraryName: ctx.library.manifest.name,
      tarball: ctx.library.tarball,
      plan,
      angularMajor: angular.major,
      cacheDir: ctx.cacheDir,
      offline: ctx.offline,
      allowScripts: ctx.allowScripts,
    });
    if (installed.skippedScripts.length) report.skippedInstallScripts = installed.skippedScripts;
    if (installed.environment) return notChecked('The install', installed.environment, installed.errorLines);
    checks.install = result(installed.pass ? 'pass' : 'fail', installed.message, {
      errorLines: installed.errorLines,
      durationMs: Date.now() - installStarted,
    });
    if (!installed.pass) return finish();

    const actual = installedAngular(appDir, angular.version);
    report.angularVersion = actual;
    const partial = judgePartial(ctx.summary, actual);
    checks.partial = result(partial.pass ? 'pass' : 'fail', partial.message, {
      advisory: partial.advisory,
      hint: partial.pass ? undefined : 'Build the library with the oldest Angular you support, or take this version out of the peer range.',
    });
    if (!partial.pass) return finish();

    let files: string[] | undefined;
    let api: PublicApi | undefined;
    if (!ctx.consumer) {
      try {
        api = readPublicApi(appDir, entryPoints(ctx.library.manifest as Parameters<typeof entryPoints>[0]));
        writeSmoke(appDir, renderSmoke(api, { signalWriteBrand: hasSignalWriteBrand(appDir) }));
        files = ['src/ngm-main.ts'];
      } catch (error) {
        checks.aot = result('fail', `Couldn't generate the smoke app from the package's typings: ${(error as Error).message}`, {
          hint: 'If the typings are fine, give ng-matrix an example app with --consumer.',
        });
        return finish();
      }
    }
    const project = configureBuild(appDir, files?.[0]);

    ctx.log(`${tag}: AOT build`);
    let aot = await ngBuild(appDir, project.tsConfig, { strictTemplates: false, skipLibCheck: true }, files);
    if (aot.environment) return notChecked('The AOT build', aot.environment, aot.errorLines);

    const omittedList: Array<{ entry: string; missingPackage: string }> = [];
    while (!aot.pass && !ctx.consumer && api) {
      const undeclared = findUndeclaredImports(aot.errorLines, ctx.library.manifest as any, api.entries);
      if (!undeclared.length) break;

      const mainName = ctx.library.manifest.name;
      const isMain = (entry: string) => entry === mainName || entry === '.';
      const mainUndeclared = undeclared.find((u) => isMain(u.entry));
      const omittedSet = new Set(undeclared.map((u) => u.entry));
      const remainingEntries = api.entries.filter((e) => !omittedSet.has(e));

      if (mainUndeclared || remainingEntries.length === 0) {
        const item = mainUndeclared ?? undeclared[0];
        const reason = `${item.entry} imports ${item.missingPackage}, which isn't declared in dependencies or peers. Every user of ${item.entry} needs ${item.missingPackage} installed.`;
        checks.aot = result('fail', reason, {
          errorLines: aot.errorLines,
          hint: reason,
          durationMs: aot.durationMs,
        });
        return finish();
      }

      omittedList.push(...undeclared);
      api.entries = remainingEntries;
      api.declarables = api.declarables.filter((d) => !d.entry || !omittedSet.has(d.entry));
      api.pipes = api.pipes.filter((p) => !p.entry || !omittedSet.has(p.entry));
      api.modules = api.modules.filter((m) => !omittedSet.has(m.entry));
      api.services = api.services.filter((s) => !omittedSet.has(s.entry));
      writeSmoke(appDir, renderSmoke(api, { signalWriteBrand: hasSignalWriteBrand(appDir) }));
      ctx.log(`${tag}: re-running AOT build without omitted entry points: ${[...omittedSet].join(', ')}`);
      aot = await ngBuild(appDir, project.tsConfig, { strictTemplates: false, skipLibCheck: true }, files);
      if (aot.environment) return notChecked('The AOT build', aot.environment, aot.errorLines);
    }
    if (omittedList.length) {
      report.omittedEntryPoints = omittedList;
    }

    checks.aot = result(aot.pass ? 'pass' : 'fail', aot.pass ? 'Production build succeeded.' : 'Production build failed.', {
      errorLines: aot.errorLines,
      hint: aot.hint,
      durationMs: aot.durationMs,
    });
    if (!aot.pass) return finish();

    ctx.log(`${tag}: strict build`);
    const strict = await ngBuild(appDir, project.tsConfig, { strictTemplates: true, skipLibCheck: false }, files);
    if (strict.environment) return notChecked('The strict build', strict.environment, strict.errorLines);
    const dtsOnly = !strict.pass && isDtsOnlyFailure(strict.errorLines);
    if (dtsOnly) {
      report.dtsErrors = true;
    }
    const dtsHint = strict.hint ?? (dtsOnly ? 'library typings have errors with skipLibCheck: false' : undefined);
    checks.strict = result(
      strict.pass || dtsOnly ? 'pass' : 'fail',
      strict.pass
        ? 'Builds with strictTemplates: true and skipLibCheck: false.'
        : dtsOnly
          ? 'Builds with strictTemplates: true; library typings have errors with skipLibCheck: false.'
          : (dtsHint ?? 'Fails with strictTemplates: true and skipLibCheck: false.'),
      {
        errorLines: strict.errorLines,
        hint: dtsHint,
        durationMs: strict.durationMs,
      },
    );
    if (checks.strict.status === 'fail') return finish();

    if (ctx.tests) {
      if (!ctx.workspace) {
        checks.tests = result('off', 'No workspace to test: the package came from --tarball or --package.');
      } else {
        ctx.log(`${tag}: library tests`);
        const tests = await runLibraryTests({
          workspace: ctx.workspace,
          into: join(versionDir, 'tests'),
          angular,
          peerVersions: plan.installs,
          pm: ctx.pm,
          command: ctx.testCommand,
          registry: ctx.registry,
          cacheDir: ctx.cacheDir,
          offline: ctx.offline,
          allowScripts: ctx.allowScripts,
        });
        if (tests.environment) return notChecked('The library tests', tests.environment, tests.errorLines);
        checks.tests = result(tests.pass ? 'pass' : 'fail', tests.message, {
          errorLines: tests.errorLines,
          durationMs: tests.durationMs,
        });
      }
    }
    return finish();
  } finally {
    if (!ctx.keep) rmSync(versionDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Copies the author's example app and moves its Angular dependencies to this version. */
async function copyConsumer(
  ctx: RunContext,
  angular: AngularMajor,
  peerVersions: Record<string, string>,
  versionDir: string,
): Promise<string> {
  const source = ctx.consumer!;
  if (!existsSync(join(source, 'angular.json'))) throw new Error(`--consumer ${source} has no angular.json.`);
  const appDir = join(versionDir, 'app');
  const skip = new Set(['node_modules', '.angular', 'dist', '.git']);
  cpSync(source, appDir, {
    recursive: true,
    filter: (path) => !relative(source, path).split(sep).some((part) => skip.has(part)),
  });
  for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) rmSync(join(appDir, lock), { force: true });
  const manifestPath = join(appDir, 'package.json');
  const manifest = readJson<Record<string, unknown> & { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
    manifestPath,
  );
  const request = { angular, peerVersions };
  if (manifest.dependencies) manifest.dependencies = swapVersions(manifest.dependencies, request);
  if (manifest.devDependencies) manifest.devDependencies = swapVersions(manifest.devDependencies, request);
  // The package under test comes from the tarball, not from wherever the example points.
  delete manifest.dependencies?.[ctx.library.manifest.name];
  delete manifest.devDependencies?.[ctx.library.manifest.name];
  writeJson(manifestPath, manifest);
  return appDir;
}

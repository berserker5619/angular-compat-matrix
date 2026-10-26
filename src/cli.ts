#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import semver from 'semver';
import type { PackageManager } from './app.ts';
import { LibraryError, prepareLibrary } from './library.ts';
import type { Report } from './model.ts';
import { scanPackage, summarize } from './partial.ts';
import { Registry } from './registry.ts';
import { exitCode, findings, renderJson, renderMarkdown, renderTerminal } from './report.ts';
import { defaultConcurrency, runAll } from './run.ts';
import { defaultCacheDir } from './tools.ts';
import {
  type AngularMajor,
  defaultMajors,
  describeMajor,
  loadVersionSources,
  majorsOf,
  nextVersion,
  nodeSatisfies,
  parseVersionList,
} from './versions.ts';

const HELP = `ng-matrix: which Angular versions does your published library really work with?

It builds and packs your library, installs the tarball into a fresh app for each Angular
major (made with that major's own CLI), builds it, and reports a matrix.

Usage
  npx ng-matrix [options]

Options
  --versions <list>      Angular majors to check: 22, 18-22, 20,22. Default: the supported
                         majors, every major the peer range claims (from 17), and the newest
  --next                 Also check whatever the \`next\` tag points to
  --project <name>       The library project, in a workspace with several
  --consumer <dir>       Build your own example app instead of a generated smoke app
  --tests                Also run the library's tests on each version (slow)
  --test-command <cmd>   The test command for --tests (default: <pm> test)
  --format <format>      terminal (default), markdown or json
  --pm <npm|pnpm>        Package manager for the apps (default: pnpm if there's a
                         pnpm-lock.yaml, else npm)
  --build <cmd>          Build the library with this command instead of the detected one
  --skip-build           Pack the existing build output as is
  --tarball <file>       Check this packed .tgz instead of building
  --package <spec>       Check a published package, e.g. some-lib@3.1.0
  --concurrency <n>      Versions checked at once (default: as many as free memory allows)
  --keep                 Keep the temporary apps, for debugging
  --offline              Use only cached registry answers and packages
  --cwd <dir>            The library's workspace (default: the current folder)
  --verbose              Show every error line, not just the first few
  -h, --help             This help
  -v, --version          ng-matrix's version

Exit code: 1 when a version inside the peer range fails, 2 when a version couldn't be
checked at all, 0 otherwise. A version outside the range that fails is a note, not an error.
`;

function toolVersion(): string {
  const manifest = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

/** A problem ng-matrix explains and stops on, with exit code 2. */
class Stop extends Error {
  readonly lines: string[];
  constructor(message: string, lines: string[] = []) {
    super(message);
    this.lines = lines;
  }
}

function fail(message: string, lines: string[] = []): never {
  throw new Stop(message, lines);
}

function explain(error: unknown): number {
  if (error instanceof Stop || error instanceof LibraryError) {
    process.stderr.write(`ng-matrix: ${error.message}\n${error.lines.map((l) => `  ${l}\n`).join('')}`);
  } else if (String((error as { code?: string }).code).startsWith('ERR_PARSE_ARGS')) {
    process.stderr.write(`ng-matrix: ${(error as Error).message}. See --help.\n`);
  } else {
    process.stderr.write(`ng-matrix: unexpected error\n${(error as Error).stack ?? String(error)}\n`);
  }
  return 2;
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      versions: { type: 'string' },
      next: { type: 'boolean', default: false },
      project: { type: 'string' },
      consumer: { type: 'string' },
      tests: { type: 'boolean', default: false },
      'test-command': { type: 'string' },
      format: { type: 'string', default: 'terminal' },
      pm: { type: 'string' },
      build: { type: 'string' },
      'skip-build': { type: 'boolean', default: false },
      tarball: { type: 'string' },
      package: { type: 'string' },
      concurrency: { type: 'string' },
      keep: { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
      cwd: { type: 'string' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${toolVersion()}\n`);
    return 0;
  }
  if (positionals[0] === 'ci') fail('`ng-matrix ci github` is planned for v0.2.');
  if (positionals.length) fail(`Unknown argument "${positionals[0]}". See --help.`);

  const format = values.format!;
  if (!['terminal', 'markdown', 'json'].includes(format)) fail(`--format must be terminal, markdown or json, not "${format}".`);
  const cwd = resolve(values.cwd ?? process.cwd());
  const pm = (values.pm ?? (existsSync(join(cwd, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm')) as PackageManager;
  if (pm !== 'npm' && pm !== 'pnpm') fail(`--pm must be npm or pnpm (yarn and bun come later), not "${pm}".`);
  const consumer = values.consumer ? resolve(cwd, values.consumer) : undefined;
  const log = (line: string) => process.stderr.write(`[ng-matrix] ${line}\n`);

  const cacheDir = defaultCacheDir();
  const registry = new Registry({
    cacheDir,
    offline: values.offline,
    recordedDir: process.env.NG_MATRIX_RECORDED_REGISTRY,
  });
  const workDir = mkdtempSync(join(tmpdir(), 'ng-matrix-'));
  if (values.keep) log(`Working in ${workDir} (--keep)`);

  try {
    const library = await prepareLibrary(
        {
          cwd,
          project: values.project,
          build: values.build,
          skipBuild: values['skip-build'],
          tarball: values.tarball,
          packageSpec: values.package,
        },
        workDir,
        log,
      );
    const summary = summarize(scanPackage(library.dir));

    const now = new Date();
    const sources = await loadVersionSources(registry);
    const majors = values.versions
      ? parseVersionList(values.versions)
      : defaultMajors(sources.core, library.manifest.peerDependencies?.['@angular/core'], now);
    const published = new Set(majorsOf(sources.core));
    for (const major of majors) if (!published.has(major)) fail(`Angular ${major} isn't published on npm.`);
    const angular: AngularMajor[] = majors.map((major) => describeMajor(sources, major, now));
    const next = values.next ? nextVersion(sources.core) : undefined;
    if (values.next && !next) log('The `next` tag is not ahead of `latest` right now; nothing extra to check.');
    if (next) angular.push(describeMajor(sources, semver.major(next), now, next));

    // One Node for every version: Angular's engines ranges only set minimums.
    const tooOld = angular.filter((a) => !nodeSatisfies(process.version, a.nodeRanges));
    if (tooOld.length) {
      fail(
        `This Node (${process.version}) can't run ${tooOld.map((a) => `Angular ${a.major}`).join(', ')}.`,
        tooOld.map((a) => `Angular ${a.major} needs Node ${a.nodeRanges.join(' and ')}`).concat(
          'Use a Node that satisfies every version you check (24.15 or later covers 17 to 22), or check fewer versions.',
        ),
      );
    }

    const concurrency = values.concurrency ? Math.max(1, Number(values.concurrency)) : defaultConcurrency(angular.length);
    log(`Checking ${library.manifest.name}@${library.manifest.version} on ${angular.map((a) => a.version).join(', ')} with ${pm}, ${concurrency} at a time`);
    const versions = await runAll(
      {
        library,
        summary,
        pm,
        registry,
        cacheDir,
        offline: values.offline,
        workDir,
        workspace: values.tarball || values.package ? undefined : cwd,
        tests: values.tests,
        testCommand: values['test-command'],
        consumer,
        keep: values.keep,
        log,
      },
      angular,
      concurrency,
    );

    const report: Report = {
      tool: { name: 'ng-matrix', version: toolVersion() },
      checkedAt: now.toISOString(),
      library: {
        name: library.manifest.name,
        version: library.manifest.version,
        source: library.source,
        compiledWith: summary.compiledWith,
        highestMinVersion: summary.highest?.minVersion,
        highestMinVersionIn: summary.highest ? `${summary.highest.type} (${summary.highest.file})` : undefined,
        declarations: summary.declarations,
      },
      packageManager: pm,
      node: process.version,
      versions,
      findings: findings(versions, library.manifest),
      exitCode: exitCode(versions),
    };
    const render = format === 'json' ? renderJson : format === 'markdown' ? renderMarkdown : (r: Report) => renderTerminal(r, values.verbose);
    process.stdout.write((format === 'terminal' ? '\n' : '') + render(report));
    return report.exitCode;
  } catch (error) {
    return explain(error);
  } finally {
    if (!values.keep) rmSync(workDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => process.exit(explain(error)),
);

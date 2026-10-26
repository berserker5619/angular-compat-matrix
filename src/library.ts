import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import * as tar from 'tar';
import { environmentProblem, errorLines, exec, npm, quietEnv } from './exec.ts';
import type { LibraryManifest } from './peers.ts';

export interface LibraryOptions {
  cwd: string;
  project?: string;
  /** Replace the detected build command. */
  build?: string;
  skipBuild?: boolean;
  /** Check this tarball as is: no build, no pack. */
  tarball?: string;
  /** Check a published package (`name@version`) from the registry. */
  packageSpec?: string;
}

export interface PackedLibrary {
  manifest: LibraryManifest;
  tarball: string;
  /** The extracted tarball's `package/` folder. */
  dir: string;
  /** How the package was built, for the report. */
  source: string;
}

export class LibraryError extends Error {
  readonly lines: string[];
  constructor(message: string, lines: string[] = []) {
    super(message);
    this.lines = lines;
  }
}

interface BuildPlan {
  kind: 'angular-cli' | 'ng-packagr';
  label: string;
  dest: string;
  run: () => Promise<{ code: number; output: string }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** `dest` from an ng-package.json (or a package.json `ngPackage` field): the same for the CLI, ng-packagr and Nx. */
export function ngPackageDest(ngPackagePath: string): string {
  const config = basename(ngPackagePath) === 'package.json'
    ? (readJson<{ ngPackage?: { dest?: string } }>(ngPackagePath).ngPackage ?? {})
    : readJson<{ dest?: string }>(ngPackagePath);
  return resolve(dirname(ngPackagePath), config.dest ?? 'dist');
}

function resolveBin(cwd: string, pkg: string, bin: string): string {
  const require = createRequire(join(cwd, 'noop.js'));
  let manifestPath: string;
  try {
    manifestPath = require.resolve(`${pkg}/package.json`);
  } catch {
    throw new LibraryError(`${pkg} isn't installed in ${cwd}. Install the workspace's dependencies first.`);
  }
  const manifest = readJson<{ bin?: string | Record<string, string> }>(manifestPath);
  const relativeBin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[bin];
  if (!relativeBin) throw new LibraryError(`${pkg} has no "${bin}" command.`);
  return join(dirname(manifestPath), relativeBin);
}

export function detectBuild(options: LibraryOptions): BuildPlan {
  const { cwd } = options;
  const shell = (command: string) => () => exec(command, [], { cwd, shell: true });

  const angularJson = join(cwd, 'angular.json');
  if (existsSync(angularJson)) {
    const workspace = readJson<{
      projects: Record<string, { projectType?: string; root?: string; architect?: Record<string, { options?: { project?: string } }> }>;
    }>(angularJson);
    const libraries = Object.entries(workspace.projects).filter(([, p]) => p.projectType === 'library');
    if (!libraries.length) throw new LibraryError('angular.json has no library project.');
    let name = options.project;
    if (!name) {
      if (libraries.length > 1) {
        throw new LibraryError(
          `This workspace has ${libraries.length} libraries (${libraries.map(([n]) => n).join(', ')}). Pick one with --project.`,
        );
      }
      name = libraries[0][0];
    }
    const project = workspace.projects[name];
    if (!project || project.projectType !== 'library') throw new LibraryError(`No library project named "${name}" in angular.json.`);
    const ngPackage = project.architect?.build?.options?.project ?? join(project.root ?? '', 'ng-package.json');
    const dest = ngPackageDest(resolve(cwd, ngPackage));
    if (options.build) return { kind: 'angular-cli', label: options.build, dest, run: shell(options.build) };
    return {
      kind: 'angular-cli',
      label: `ng build ${name} --configuration production`,
      dest,
      run: () =>
        exec(process.execPath, [resolveBin(cwd, '@angular/cli', 'ng'), 'build', name, '--configuration', 'production'], {
          cwd,
          env: quietEnv(),
        }),
    };
  }

  const ngPackage = ['ng-package.json', 'package.json'].map((f) => join(cwd, f)).find((path) => {
    if (!existsSync(path)) return false;
    return basename(path) === 'ng-package.json' || Boolean(readJson<{ ngPackage?: unknown }>(path).ngPackage);
  });
  if (ngPackage) {
    const dest = ngPackageDest(ngPackage);
    if (options.build) return { kind: 'ng-packagr', label: options.build, dest, run: shell(options.build) };
    const manifest = existsSync(join(cwd, 'package.json')) ? readJson<LibraryManifest>(join(cwd, 'package.json')) : undefined;
    if (manifest?.scripts?.build) {
      return { kind: 'ng-packagr', label: 'npm run build', dest, run: () => npm(['run', 'build'], { cwd }) };
    }
    return {
      kind: 'ng-packagr',
      label: 'ng-packagr -p ng-package.json',
      dest,
      run: () => exec(process.execPath, [resolveBin(cwd, 'ng-packagr', 'ng-packagr'), '-p', ngPackage], { cwd }),
    };
  }

  if (existsSync(join(cwd, 'nx.json'))) {
    throw new LibraryError(
      'Nx workspaces are planned for v0.2. For now, run ng-matrix from the library folder (the one with ng-package.json) with --build "npx nx build <lib>".',
    );
  }
  throw new LibraryError(
    'No Angular library here: expected angular.json with a library project, or ng-package.json. Or pass --tarball / --package.',
  );
}

/**
 * Full compilation output must never be published: ng-packagr guards that with a `prepublishOnly`
 * script, which `npm pack` doesn't run. So ng-matrix checks for it itself.
 */
export function fullCompilationEvidence(dir: string): string | undefined {
  const manifestPath = join(dir, 'package.json');
  if (existsSync(manifestPath)) {
    const guard = readJson<LibraryManifest>(manifestPath).scripts?.prepublishOnly ?? '';
    if (/full compilation mode/i.test(guard)) return 'its package.json has ng-packagr\'s "full compilation mode" prepublishOnly guard';
  }
  const define = /ɵɵdefine(Component|Directive|Pipe|NgModule)\(/;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules') continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) stack.push(path);
      else if (/\.m?js$/.test(entry)) {
        const match = define.exec(readFileSync(path, 'utf8'));
        if (match) return `${path.slice(dir.length + 1)} calls ɵɵdefine${match[1]}, which only full compilation emits`;
      }
    }
  }
  return undefined;
}

async function pack(source: string, into: string): Promise<string> {
  const result = await npm(['pack', source, '--pack-destination', into, '--json', '--ignore-scripts'], { cwd: into });
  if (result.code !== 0) throw new LibraryError(packFailure(source, result.output), errorLines(result.output));
  const json = result.output.slice(result.output.indexOf('['));
  const [info] = JSON.parse(json) as Array<{ filename: string }>;
  // Scoped packages: npm reports "@scope/name-1.0.0.tgz" but writes "scope-name-1.0.0.tgz".
  return join(into, info.filename.replace(/^@/, '').replace('/', '-'));
}

/** What went wrong with `npm pack <spec>`, in words: most often the name or the version doesn't exist. */
export function packFailure(spec: string, output: string): string {
  if (/\bE404\b|404 Not Found/.test(output)) return `There's no package ${spec.replace(/(.)@[^@]*$/, '$1')} on the npm registry.`;
  if (/\bETARGET\b|No matching version/.test(output)) return `${spec} doesn't match any published version.`;
  const why = environmentProblem({ output, timedOut: false });
  if (why) return `Couldn't download ${spec}: ${why}.`;
  return `npm pack ${spec} failed.`;
}

export async function extract(tarball: string, into: string): Promise<string> {
  mkdirSync(into, { recursive: true });
  try {
    await tar.x({ file: tarball, cwd: into, strict: true });
  } catch (error) {
    throw new LibraryError(`${tarball} isn't a package tarball (.tgz): ${(error as Error).message}`);
  }
  const dir = join(into, 'package');
  if (!existsSync(join(dir, 'package.json'))) throw new LibraryError(`${tarball} has no package/package.json.`);
  return dir;
}

export async function prepareLibrary(options: LibraryOptions, workDir: string, log: (line: string) => void): Promise<PackedLibrary> {
  const packDir = join(workDir, 'pack');
  mkdirSync(packDir, { recursive: true });
  let tarball: string;
  let source: string;

  if (options.tarball) {
    tarball = resolve(options.cwd, options.tarball);
    if (!existsSync(tarball)) throw new LibraryError(`No tarball at ${tarball}.`);
    source = `tarball ${tarball}`;
  } else if (options.packageSpec) {
    log(`Downloading ${options.packageSpec}…`);
    tarball = await pack(options.packageSpec, packDir);
    source = `${options.packageSpec} from the registry`;
  } else {
    const plan = detectBuild(options);
    if (!options.skipBuild) {
      log(`Building the library: ${plan.label}`);
      const built = await plan.run();
      if (built.code !== 0) throw new LibraryError(`The library build failed (${plan.label}).`, errorLines(built.output));
    }
    if (!existsSync(join(plan.dest, 'package.json'))) {
      throw new LibraryError(`No package.json in the build output ${plan.dest}. Is ng-package.json's "dest" right?`);
    }
    const full = fullCompilationEvidence(plan.dest);
    if (full) {
      throw new LibraryError(
        `Refusing to pack ${plan.dest}: it was built in full compilation mode (${full}). Libraries must be published in partial mode; build with the production configuration or set "compilationMode": "partial".`,
      );
    }
    tarball = await pack(plan.dest, packDir);
    source = `${plan.label}, then npm pack`;
  }

  const dir = await extract(tarball, join(packDir, 'contents'));
  if (options.tarball || options.packageSpec) {
    const full = fullCompilationEvidence(dir);
    if (full) throw new LibraryError(`This package was built in full compilation mode (${full}); Angular apps can't use it reliably.`);
  }
  return { manifest: readJson<LibraryManifest>(join(dir, 'package.json')), tarball, dir, source };
}

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorLines, exec, quietEnv } from './exec.ts';
import { binOf, ensureTool } from './tools.ts';
import type { AngularMajor } from './versions.ts';

export type PackageManager = 'npm' | 'pnpm';

/** One flag set that works, without prompts, for every CLI from 17 to 22. */
export function newAppArgs(pm: PackageManager): string[] {
  return [
    'new',
    'smoke',
    '--minimal',
    '--skip-git',
    '--skip-install',
    '--defaults',
    '--interactive=false',
    '--ssr=false',
    `--package-manager=${pm}`,
  ];
}

export async function generateApp(
  angular: AngularMajor,
  pm: PackageManager,
  parentDir: string,
  cacheDir: string,
  offline: boolean,
): Promise<string> {
  const cli = await ensureTool(cacheDir, '@angular/cli', angular.cliVersion, offline);
  const result = await exec(process.execPath, [binOf(cli, 'ng'), ...newAppArgs(pm)], {
    cwd: parentDir,
    env: quietEnv({ CI: '1' }),
    timeoutMs: 10 * 60_000,
  });
  const appDir = join(parentDir, 'smoke');
  if (result.code !== 0 || !existsSync(join(appDir, 'angular.json'))) {
    throw new Error(`ng new (Angular CLI ${angular.cliVersion}) failed:\n${errorLines(result.output).join('\n')}`);
  }
  return appDir;
}

export function readJson<T = Record<string, unknown>>(path: string): T {
  // Generated tsconfig files start with /* comments */; JSON.parse can't take them.
  const text = readFileSync(path, 'utf8').replace(/^\s*\/\*[\s\S]*?\*\/\s*/gm, '').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(text) as T;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

interface AngularJson {
  projects: Record<
    string,
    {
      projectType?: string;
      architect?: Record<
        string,
        {
          builder?: string;
          options?: Record<string, unknown>;
          configurations?: Record<string, Record<string, unknown>>;
        }
      >;
    }
  >;
}

export interface AppProject {
  name: string;
  tsConfig: string;
}

/** The app project in angular.json: the generated one, or the first application of a --consumer app. */
export function appProject(appDir: string): AppProject {
  const workspace = readJson<AngularJson>(join(appDir, 'angular.json'));
  const entry = Object.entries(workspace.projects).find(([, p]) => (p.projectType ?? 'application') === 'application');
  if (!entry) throw new Error(`${appDir}/angular.json has no application project.`);
  const [name, project] = entry;
  const tsConfig = String(project.architect?.build?.options?.tsConfig ?? 'tsconfig.app.json');
  return { name, tsConfig };
}

/**
 * Points the build at ng-matrix's own tsconfig (and, for a generated app, its own main file),
 * and removes the production budgets so a large component kit doesn't fail the build on size.
 */
export function configureBuild(appDir: string, mainFile: string | undefined): AppProject {
  const path = join(appDir, 'angular.json');
  const workspace = readJson<AngularJson>(path);
  const project = appProject(appDir);
  const build = workspace.projects[project.name].architect!.build!;
  build.options ??= {};
  if (mainFile) {
    // `browser` for the application builder (17+), `main` for the older webpack one.
    if ('main' in build.options && !('browser' in build.options)) build.options.main = mainFile;
    else build.options.browser = mainFile;
  }
  build.options.tsConfig = 'tsconfig.ngm.json';
  for (const configuration of Object.values(build.configurations ?? {})) {
    if ('budgets' in configuration) configuration.budgets = [];
  }
  writeJson(path, workspace);
  return project;
}

export interface BuildMode {
  strictTemplates: boolean;
  skipLibCheck: boolean;
}

/**
 * Writes tsconfig.ngm.json extending the app's own tsconfig, with the template strictness set
 * explicitly: Angular 17 to 21 apps write strictTemplates: true, and 22 makes it the default.
 */
export function writeTsconfig(appDir: string, baseTsConfig: string, mode: BuildMode, files?: string[]): void {
  const config: Record<string, unknown> = {
    extends: `./${baseTsConfig.replace(/^\.\//, '')}`,
    compilerOptions: { skipLibCheck: mode.skipLibCheck },
    angularCompilerOptions: { strictTemplates: mode.strictTemplates },
  };
  if (files) {
    config.files = files;
    config.include = [];
  }
  writeJson(join(appDir, 'tsconfig.ngm.json'), config);
}

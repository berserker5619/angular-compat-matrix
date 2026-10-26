import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { type BuildMode, writeTsconfig } from './app.ts';
import { environmentProblem, errorLines, exec, quietEnv, stepTimeout } from './exec.ts';

export interface BuildOutcome {
  pass: boolean;
  errorLines: string[];
  fullOutput?: string;
  hint?: string;
  durationMs: number;
  /** The machine's fault (a timeout, a full disk), not the package's. */
  environment?: string;
}

export async function ngBuild(appDir: string, baseTsConfig: string, mode: BuildMode, files?: string[]): Promise<BuildOutcome> {
  writeTsconfig(appDir, baseTsConfig, mode, files);
  const require = createRequire(join(appDir, 'package.json'));
  const cliManifest = require.resolve('@angular/cli/package.json');
  const ng = join(dirname(cliManifest), 'bin', 'ng.js');
  const result = await exec(process.execPath, [ng, 'build', '--configuration', 'production'], {
    cwd: appDir,
    env: quietEnv({ CI: '1' }),
    timeoutMs: stepTimeout(),
  });
  if (result.code === 0) return { pass: true, errorLines: [], durationMs: result.durationMs };
  const lines = errorLines(result.output);
  return {
    pass: false,
    errorLines: lines,
    fullOutput: result.output,
    hint: hintFor(result.output) ?? lines[0],
    durationMs: result.durationMs,
    environment: environmentProblem(result),
  };
}

/** Plain-language explanations for build failures whose messages don't say what's wrong. */
export function hintFor(output: string): string | undefined {
  if (/Unsupported enum value|Cannot create property 'message' on string/.test(output)) {
    return 'The compiled code uses features newer than this Angular, though its minVersion says otherwise: the linker crashed on it. Build the library with the oldest Angular you support.';
  }
  const linker = /depends upon a library published using Angular version ([\d.]+), which requires Angular version ([\d.]+) or newer/.exec(output);
  if (linker) {
    return `The package was compiled with Angular ${linker[1]} and needs Angular ${linker[2]} or newer. Build it with the oldest Angular you support.`;
  }
  const missing = /No matching export in "[^"]*node_modules[\\/](@angular[\\/][\w-]+)[^"]*" for import "([\w$ɵ]+)"/.exec(output);
  if (missing) {
    return `The package imports ${missing[2]} from ${missing[1].replace('\\', '/')}, which this Angular version doesn't have.`;
  }
  // TS2305 inside a .d.ts: `Module '"@angular/core"' has no exported member 'X'`, with the file on the next line.
  const member = /Module '"([^"]+)"' has no exported member(?: named)? '([\w$ɵ]+)'[\s\S]{0,300}?node_modules[\\/](?:\.pnpm[\\/]\S*?[\\/]node_modules[\\/])?((?:@[\w.-]+[\\/])?[\w.-]+)[\\/]\S*\.d\.ts/.exec(
    output,
  );
  if (member) {
    const pkg = member[3].replace('\\', '/');
    return `${pkg}'s typings use ${member[2]}, which this version's ${member[1]} doesn't export. Apps with skipLibCheck: false, or that use the type, fail to compile.`;
  }
  if (/has no exported member(?: named)? '([\w$ɵ]+)'/.test(output) && /\.d\.ts/.test(output)) {
    return "The package's typings use a type this Angular doesn't export. Apps with skipLibCheck: false fail to compile.";
  }
  if (isDtsOnlyFailure(errorLines(output))) {
    return 'library typings have errors with skipLibCheck: false';
  }
  if (/error NG8002|error NG8008|is not assignable to type|TS2322/.test(output)) {
    return 'A template using the package type-checks only loosely: with strict templates, Angular reports the error above. If it comes from a bare attribute like <div myDirective>, give that boolean input a booleanAttribute transform.';
  }
  return undefined;
}

/**
 * Whether the build failed only because of errors inside declaration files (.d.ts)
 * of a library, with no errors in the smoke app's templates or components.
 */
export function isDtsOnlyFailure(lines: string[]): boolean {
  if (!lines.length) return false;
  let hasDtsError = false;
  for (const line of lines) {
    if (/error NG\d+/.test(line)) return false;
    if (/(?:src[\\/]ngm-smoke|src[\\/]ngm-main)\.ts/i.test(line)) return false;
    if (/\.d\.ts(?::|\s|$)/i.test(line)) hasDtsError = true;
  }
  return hasDtsError;
}

export interface UndeclaredImport {
  entry: string;
  missingPackage: string;
}

function packageNameFromSpecifier(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

function isDeclared(
  pkg: string,
  manifest: { dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; name?: string },
): boolean {
  if (pkg === manifest.name) return true;
  if (manifest.dependencies && pkg in manifest.dependencies) return true;
  if (manifest.peerDependencies && pkg in manifest.peerDependencies) return true;
  if (manifest.optionalDependencies && pkg in manifest.optionalDependencies) return true;
  return false;
}

function findEntryPointForFile(
  filePath: string,
  manifest: { name: string; exports?: unknown },
  entries: string[],
): string {
  if (entries.length <= 1) return entries[0] ?? manifest.name;
  const normalizedPath = filePath.replace(/\\/g, '/');
  const exportsMap = manifest.exports;
  if (exportsMap && typeof exportsMap === 'object') {
    for (const [key, value] of Object.entries(exportsMap as Record<string, unknown>)) {
      const entryName = key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`;
      if (typeof value === 'string') {
        const clean = value.replace(/^\.\//, '');
        if (normalizedPath.endsWith(clean)) return entryName;
      } else if (value && typeof value === 'object') {
        for (const target of Object.values(value as Record<string, unknown>)) {
          if (typeof target === 'string') {
            const clean = target.replace(/^\.\//, '');
            if (normalizedPath.endsWith(clean)) return entryName;
          }
        }
      }
    }
  }
  for (const entry of entries) {
    if (entry === manifest.name) continue;
    const sub = entry.slice(manifest.name.length + 1);
    if (normalizedPath.includes(sub) || normalizedPath.includes(sub.replace(/\//g, '-'))) {
      return entry;
    }
  }
  return entries[0] ?? manifest.name;
}

/**
 * Spots when a build fails ONLY because entry points import packages that aren't declared
 * in dependencies, peerDependencies or optionalDependencies (e.g. chart.js, lodash, cron-parser).
 */
export function findUndeclaredImports(
  lines: string[],
  manifest: { name: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; exports?: unknown },
  entries: string[],
): UndeclaredImport[] {
  const undeclared: UndeclaredImport[] = [];
  const seen = new Set<string>();
  let hasOtherErrors = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const esbuildMatch = /Could not resolve ["']([^"']+)["']/.exec(line);
    const webpackMatch = /Can't resolve '([^']+)'/.exec(line);
    const specifier = esbuildMatch?.[1] ?? webpackMatch?.[1];

    if (specifier) {
      const pkg = packageNameFromSpecifier(specifier);
      if (!isDeclared(pkg, manifest)) {
        let filePath = '';
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const locMatch = /(?:^|\s+)([A-Za-z]:[\\/][^\s:]+|node_modules[\\/][^\s:]+|[^\s:]+):\d+:\d+:/.exec(lines[j]);
          if (locMatch) {
            filePath = locMatch[1];
            break;
          }
        }
        const entry = findEntryPointForFile(filePath, manifest, entries);
        const key = `${entry}\0${pkg}`;
        if (!seen.has(key)) {
          seen.add(key);
          undeclared.push({ entry, missingPackage: pkg });
        }
      } else {
        hasOtherErrors = true;
      }
    } else if (/^X \[ERROR\]/.test(line) && !line.includes('Could not resolve')) {
      hasOtherErrors = true;
    }
  }

  return hasOtherErrors ? [] : undeclared;
}


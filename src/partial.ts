import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import semver from 'semver';

/** One `ɵɵngDeclare…(…)` call in the published JavaScript. */
export interface Declaration {
  kind: string;
  type: string;
  minVersion: string;
  version: string;
  file: string;
}

export interface PartialSummary {
  declarations: number;
  highest?: Declaration;
  /** The Angular version that compiled the package, from the declarations' `version` field. */
  compiledWith?: string;
}

const DECLARE = /ɵɵngDeclare(\w+)\(\s*\{/g;

export function scanSource(source: string, file: string): Declaration[] {
  const found: Declaration[] = [];
  for (const match of source.matchAll(DECLARE)) {
    // The fields come first in every declaration, well within this window.
    const body = source.slice(match.index + match[0].length, match.index + match[0].length + 800);
    const minVersion = /minVersion:\s*["']([^"']+)["']/.exec(body)?.[1];
    const version = /\bversion:\s*["']([^"']+)["']/.exec(body)?.[1];
    const type = /\btype:\s*([\w$]+)/.exec(body)?.[1] ?? '?';
    if (minVersion && version) found.push({ kind: match[1], type, minVersion, version, file });
  }
  return found;
}

export function scanPackage(dir: string): Declaration[] {
  const found: Declaration[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules') continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(mjs|js|cjs)$/.test(entry)) found.push(...scanSource(readFileSync(path, 'utf8'), relative(dir, path)));
    }
  };
  walk(dir);
  return found;
}

export function summarize(declarations: Declaration[]): PartialSummary {
  let highest: Declaration | undefined;
  let compiledWith: string | undefined;
  for (const declaration of declarations) {
    const min = semver.coerce(declaration.minVersion);
    if (min && (!highest || semver.gt(min, semver.coerce(highest.minVersion)!))) highest = declaration;
    // Angular's own source builds say 0.0.0-PLACEHOLDER; that tells us nothing.
    if (semver.valid(declaration.version) && !declaration.version.startsWith('0.0.0')) {
      if (!compiledWith || semver.gt(declaration.version, compiledWith)) compiledWith = declaration.version;
    }
  }
  return { declarations: declarations.length, highest, compiledWith };
}

export interface PartialVerdict {
  pass: boolean;
  /** A pass that proves nothing: the package was compiled with a newer major, and minVersion has been too low before. */
  advisory: boolean;
  message: string;
}

export function judgePartial(summary: PartialSummary, angularVersion: string): PartialVerdict {
  const app = semver.coerce(angularVersion)!;
  if (!summary.highest) {
    return { pass: true, advisory: false, message: 'No Angular declarations in the package.' };
  }
  const { highest } = summary;
  const where = `${highest.type} (ɵɵngDeclare${highest.kind}, ${highest.file})`;
  if (semver.lt(app, semver.coerce(highest.minVersion)!)) {
    return {
      pass: false,
      advisory: false,
      message: `Needs Angular ${highest.minVersion} or later: highest minVersion ${highest.minVersion}, in ${where}.`,
    };
  }
  const advisory = Boolean(summary.compiledWith && semver.major(summary.compiledWith) > app.major);
  return {
    pass: true,
    advisory,
    message: advisory
      ? `Highest minVersion ${highest.minVersion} allows it, but the package was compiled with Angular ${summary.compiledWith} and minVersion has been too low before, so only the build can tell.`
      : `Highest minVersion ${highest.minVersion}, in ${where}.`,
  };
}

/** The `@angular/*` packages the published JavaScript imports (`@angular/common/http` counts as `@angular/common`). */
export function angularImports(dir: string): string[] {
  const found = new Set<string>();
  const specifier = /(?:\bfrom|\bimport)\s*\(?\s*["'](@angular\/[\w.-]+)(?:\/[^"']*)?["']/g;
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules') continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(mjs|js|cjs)$/.test(entry)) for (const match of readFileSync(path, 'utf8').matchAll(specifier)) found.add(match[1]);
    }
  };
  walk(dir);
  return [...found].sort();
}

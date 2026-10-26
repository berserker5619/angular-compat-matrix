import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { type BuildMode, writeTsconfig } from './app.ts';
import { errorLines, exec, quietEnv } from './exec.ts';

export interface BuildOutcome {
  pass: boolean;
  errorLines: string[];
  hint?: string;
  durationMs: number;
}

export async function ngBuild(appDir: string, baseTsConfig: string, mode: BuildMode, files?: string[]): Promise<BuildOutcome> {
  writeTsconfig(appDir, baseTsConfig, mode, files);
  const require = createRequire(join(appDir, 'package.json'));
  const cliManifest = require.resolve('@angular/cli/package.json');
  const ng = join(dirname(cliManifest), 'bin', 'ng.js');
  const result = await exec(process.execPath, [ng, 'build', '--configuration', 'production'], {
    cwd: appDir,
    env: quietEnv({ CI: '1' }),
    timeoutMs: 20 * 60_000,
  });
  if (result.code === 0) return { pass: true, errorLines: [], durationMs: result.durationMs };
  const lines = result.timedOut ? ['The build timed out after 20 minutes.'] : errorLines(result.output);
  return { pass: false, errorLines: lines, hint: hintFor(result.output), durationMs: result.durationMs };
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
  if (/error NG8002|error NG8008|is not assignable to type|TS2322/.test(output)) {
    return 'A template using the package type-checks only loosely: with strict templates, Angular reports the error above. If it comes from a bare attribute like <div myDirective>, give that boolean input a booleanAttribute transform.';
  }
  return undefined;
}

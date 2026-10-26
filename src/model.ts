export const CHECKS = ['peer', 'install', 'partial', 'aot', 'strict', 'tests'] as const;
export type CheckName = (typeof CHECKS)[number];

export const CHECK_LABELS: Record<CheckName, string> = {
  peer: 'peer range',
  install: 'install',
  partial: 'partial',
  aot: 'AOT build',
  strict: 'strict types',
  tests: 'tests',
};

/**
 * pass / fail, or:
 * - `not-run`: an earlier check failed, so the first real failure is the one reported
 * - `off`: not requested (tests without --tests)
 * - `none`: nothing to check (no `@angular/*` peer to compare)
 */
export type CheckStatus = 'pass' | 'fail' | 'not-run' | 'off' | 'none';

export interface CheckResult {
  status: CheckStatus;
  /** Partial only: a pass that proves nothing, because the package was compiled with a newer major. */
  advisory?: boolean;
  message: string;
  errorLines: string[];
  hint?: string;
  durationMs: number;
}

export interface VersionReport {
  major: number;
  angularVersion: string;
  supported: boolean;
  prerelease: boolean;
  /** Whether the package's peer ranges claim this version: null when it declares no `@angular/*` peer. */
  claimed: boolean | null;
  /** The `@angular/*` peers whose ranges leave this version out. */
  peerMisses: Array<{ name: string; range: string; version: string }>;
  checks: Record<CheckName, CheckResult>;
  /** ng-matrix itself couldn't set this version up (ng new failed, say): not the package's fault. */
  setupError?: string;
  /** Packages in the app whose install scripts didn't run (the default; --allow-scripts runs them). */
  skippedInstallScripts?: string[];
  /** Entry points left out of the build because they import packages not declared in dependencies or peers. */
  omittedEntryPoints?: Array<{ entry: string; missingPackage: string }>;
  /** Whether strict build had typing errors only in node_modules .d.ts files with skipLibCheck: false. */
  dtsErrors?: boolean;
  durationMs: number;
  appDir?: string;
}

export interface Finding {
  level: 'error' | 'warning' | 'note';
  majors: number[];
  text: string;
  /** For a package with no `@angular/*` peer: the peerDependencies this run supports. */
  suggestedPeerDependencies?: Record<string, string>;
}

export interface Report {
  tool: { name: string; version: string };
  checkedAt: string;
  library: {
    name: string;
    version: string;
    source: string;
    compiledWith?: string;
    highestMinVersion?: string;
    highestMinVersionIn?: string;
    declarations: number;
  };
  packageManager: string;
  /** Which install scripts ran: only the Angular toolchain's (the default), or all (--allow-scripts). */
  installScripts: 'toolchain-only' | 'all';
  node: string;
  versions: VersionReport[];
  findings: Finding[];
  exitCode: number;
}

export function result(status: CheckStatus, message = '', extra: Partial<CheckResult> = {}): CheckResult {
  return { status, message, errorLines: [], durationMs: 0, ...extra };
}

import semver from 'semver';
import type { Report, VersionReport } from './model.ts';
import { exitCode, findings } from './report.ts';
import type { AngularMajor } from './versions.ts';

/*
 * `ci github` writes a workflow with three jobs: `plan` works out the Angular majors when the
 * workflow runs (so a new major needs no edit), `check` runs one job per major on a Node that
 * major supports, and `summary` joins their JSON reports into one table in the job summary.
 */

export const WORKFLOW_PATH = '.github/workflows/angular-compat-matrix.yml';

/** One `check` job: `args` selects its version, `node` is what setup-node installs. */
export interface MatrixEntry {
  name: string;
  node: string;
  args: string;
}

/**
 * The Node major for a job: the newest one named in Angular's `engines` ranges (and this tool's)
 * that satisfies all of them. The ranges only set minimums, so the newest is the safest pick.
 */
export function nodeFor(ranges: string[]): string {
  const candidates = new Set<number>();
  for (const range of ranges) {
    try {
      for (const set of new semver.Range(range).set) {
        for (const comparator of set) if (comparator.semver.major > 0) candidates.add(comparator.semver.major);
      }
    } catch {
      // An unreadable range names no candidate.
    }
  }
  const fits = [...candidates]
    .sort((a, b) => b - a)
    .find((major) => ranges.every((range) => semver.satisfies(`${major}.99.99`, range)));
  return fits ? String(fits) : 'lts/*';
}

export function planMatrix(angular: AngularMajor[], toolNode: string): MatrixEntry[] {
  const newestStable = Math.max(...angular.filter((a) => !a.prerelease).map((a) => a.major));
  return angular.map((a) => ({
    name: a.prerelease ? 'next' : String(a.major),
    node: nodeFor([...a.nodeRanges, toolNode]),
    // `--next` always comes with a stable major; the summary drops the duplicate row.
    args: a.prerelease ? `--versions ${newestStable} --next` : `--versions ${a.major}`,
  }));
}

/** Quotes one argument for bash, only when it needs it. */
export function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export interface WorkflowOptions {
  /** How the workflow runs angular-compat-matrix. */
  command: string;
  /** Options for the check runs (each job adds its own --versions). */
  args: string[];
  /** Options that pick the versions: only `plan` gets them. */
  planArgs: string[];
  install: string;
  /** Whether `plan` needs the install too: only when the command comes from the workspace. */
  installForPlan: boolean;
}

export function githubWorkflow(options: WorkflowOptions): string {
  const join = (list: string[]) => list.map((arg) => ` ${shellQuote(arg)}`).join('');
  const withArgs = join(options.args);
  const planArgs = join([...options.planArgs, ...options.args]);
  const install = `      - name: Install dependencies\n        run: ${options.install}\n`;
  return `# Written by \`angular-compat-matrix ci github\`. Checks which Angular versions the library works
# with: one job per Angular major, each on a Node that major supports, then one table in the
# summary. The majors are worked out when the workflow runs, so a new Angular major needs no edit.
name: Angular compatibility

on:
  push:
    branches: [main]
  pull_request:
  # Weekly, to catch a new Angular release before users do.
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: angular-compat-matrix-\${{ github.ref }}
  cancel-in-progress: true

env:
  ANGULAR_COMPAT_MATRIX_CACHE: \${{ github.workspace }}/../angular-compat-matrix-cache

jobs:
  plan:
    name: Angular versions
    runs-on: ubuntu-latest
    outputs:
      matrix: \${{ steps.plan.outputs.matrix }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: lts/*
${options.installForPlan ? install : ''}      - id: plan
        run: |
          matrix=$(${options.command} ci plan${planArgs})
          echo "matrix=$matrix" >> "$GITHUB_OUTPUT"

  check:
    name: Angular \${{ matrix.name }}
    needs: plan
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        include: \${{ fromJSON(needs.plan.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: \${{ matrix.node }}
${install}      - name: Cache the Angular CLIs and pnpm that angular-compat-matrix downloads
        uses: actions/cache@v6
        with:
          path: \${{ env.ANGULAR_COMPAT_MATRIX_CACHE }}/tools
          key: angular-compat-matrix-tools-\${{ runner.os }}-\${{ github.run_id }}
          restore-keys: angular-compat-matrix-tools-\${{ runner.os }}-
      - name: Check Angular \${{ matrix.name }}
        run: ${options.command} \${{ matrix.args }}${withArgs} --format json > "$RUNNER_TEMP/angular-\${{ matrix.name }}.json"
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: angular-compat-matrix-\${{ matrix.name }}
          path: \${{ runner.temp }}/angular-\${{ matrix.name }}.json

  summary:
    name: Compatibility matrix
    needs: [plan, check]
    if: always() && needs.plan.result == 'success'
    runs-on: ubuntu-latest
    steps:
${options.installForPlan ? `      - uses: actions/checkout@v7\n` : ''}      - uses: actions/setup-node@v7
        with:
          node-version: lts/*
${options.installForPlan ? install : ''}      - uses: actions/download-artifact@v8
        with:
          pattern: angular-compat-matrix-*
          merge-multiple: true
          path: \${{ runner.temp }}/results
      - run: ${options.command} ci summary "$RUNNER_TEMP"/results/*.json >> "$GITHUB_STEP_SUMMARY"
`;
}

/**
 * Joins one-version reports into one. A file that isn't a report (the job stopped before writing
 * one) makes it exit 2, like a version that couldn't be checked.
 */
export function mergeReports(reports: Report[], unreadable: string[]): { report: Report; notes: string[] } {
  if (!reports.length) throw new Error(`No reports to join${unreadable.length ? `; unreadable: ${unreadable.join(', ')}` : ''}.`);
  const seen = new Set<string>();
  const versions: VersionReport[] = [];
  for (const version of reports.flatMap((r) => r.versions)) {
    if (seen.has(version.angularVersion)) continue;
    seen.add(version.angularVersion);
    versions.push(version);
  }
  versions.sort((a, b) => a.major - b.major || Number(a.prerelease) - Number(b.prerelease));
  // findings() only asks whether the package has an @angular/* peer; `claimed` is null when it hasn't.
  const hasAngularPeer = versions.some((v) => v.claimed !== null);
  const imports = Object.keys(
    reports.flatMap((r) => r.findings).find((f) => f.suggestedPeerDependencies)?.suggestedPeerDependencies ?? {},
  );
  const first = reports[0];
  const report: Report = {
    ...first,
    checkedAt: reports.map((r) => r.checkedAt).sort()[0],
    versions,
    findings: findings(versions, { peerDependencies: hasAngularPeer ? { '@angular/core': '*' } : {} }, imports.length ? imports : undefined),
    exitCode: unreadable.length ? 2 : exitCode(versions),
  };
  const notes = unreadable.map((file) => `No report in ${file}: that job stopped before writing one; see its log.`);
  return { report, notes };
}

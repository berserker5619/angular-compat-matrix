import { type CheckName, CHECK_LABELS, CHECKS, type CheckResult, type Finding, type Report, type VersionReport } from './model.ts';

const FAILING_CHECKS: CheckName[] = ['install', 'partial', 'aot', 'strict', 'tests'];

function firstFailure(version: VersionReport): [CheckName, CheckResult] | undefined {
  for (const name of FAILING_CHECKS) {
    if (version.checks[name].status === 'fail') return [name, version.checks[name]];
  }
  return undefined;
}

/** Everything that ran, passed. */
function works(version: VersionReport): boolean {
  return !version.setupError && !firstFailure(version);
}

/** CI goes red only for broken promises (2 means angular-compat-matrix itself couldn't check a version). */
export function exitCode(versions: VersionReport[]): number {
  if (versions.some((v) => v.setupError)) return 2;
  return versions.some((v) => v.claimed === true && firstFailure(v)) ? 1 : 0;
}

export function findings(
  versions: VersionReport[],
  manifest: { peerDependencies?: Record<string, string> },
  /** The `@angular/*` packages the published code imports. */
  angularImports: string[] = ['@angular/core'],
): Finding[] {
  const raw: Array<Finding & { key: string }> = [];
  for (const version of versions) {
    const m = version.major;
    if (version.setupError) {
      raw.push({ level: 'error', majors: [m], key: `setup:${version.setupError}`, text: `angular-compat-matrix couldn't set up the app: ${version.setupError}` });
      continue;
    }
    const failure = firstFailure(version);
    if (failure) {
      const [name, check] = failure;
      // Partial's message names the declaration; a build's message is just "failed", so its hint says more.
      const why = name === 'partial' && check.hint ? `${check.message} ${check.hint}` : (check.hint ?? check.errorLines?.[0] ?? check.message);
      if (version.claimed === true) {
        raw.push({ level: 'error', majors: [m], key: `fail:${name}:${why}`, text: `${CHECK_LABELS[name]}: ${why}` });
      } else if (version.claimed === false) {
        raw.push({
          level: 'note',
          majors: [m],
          key: `outside:${name}`,
          text: `${CHECK_LABELS[name]} fails, but the peer range doesn't claim this version, so that's expected.`,
        });
      } else {
        raw.push({ level: 'warning', majors: [m], key: `fail:${name}:${why}`, text: `${CHECK_LABELS[name]}: ${why}` });
      }
      if (version.skippedInstallScripts?.length) {
        const list = version.skippedInstallScripts.join(', ');
        raw.push({
          level: 'note',
          majors: [m],
          key: `scripts:${list}`,
          text: `Install scripts didn't run for ${list} (the default). If the failure comes from one of them, check again with --allow-scripts.`,
        });
      }
    } else if (version.claimed === false) {
      const ranges = version.peerMisses.map((miss) => `${miss.name} "${miss.range}"`).join(', ');
      raw.push({
        level: 'warning',
        majors: [m],
        key: `unclaimed:${ranges}`,
        text: `works, but peerDependencies doesn't allow it (${ranges}). Widen the range to include it.`,
      });
    }
    if (version.omittedEntryPoints?.length) {
      for (const item of version.omittedEntryPoints) {
        raw.push({
          level: 'warning',
          majors: [m],
          key: `undeclared:${item.entry}:${item.missingPackage}`,
          text: `entry point ${item.entry} imports ${item.missingPackage}, which isn't declared in dependencies or peers`,
        });
      }
    }
    if (version.dtsErrors) {
      raw.push({
        level: 'warning',
        majors: [m],
        key: 'skipLibCheck:dts-errors',
        text: 'library typings have errors with skipLibCheck: false',
      });
    }
  }

  // One finding per distinct problem, listing every major it applies to.
  const merged: Finding[] = [];
  const byKey = new Map<string, Finding>();
  for (const finding of raw) {
    const existing = byKey.get(finding.key);
    if (existing) existing.majors.push(...finding.majors);
    else {
      const copy: Finding = { level: finding.level, majors: [...finding.majors], text: finding.text };
      byKey.set(finding.key, copy);
      merged.push(copy);
    }
  }

  const hasAngularPeer = Object.keys(manifest.peerDependencies ?? {}).some((n) => n.startsWith('@angular/'));
  if (!hasAngularPeer) merged.push(missingPeersFinding(versions, angularImports));
  const order = { error: 0, warning: 1, note: 2 };
  return merged.sort((a, b) => order[a.level] - order[b.level]);
}

/**
 * A package without `@angular/*` peers claims nothing, so nothing tells a package manager which
 * Angular it needs. The hint suggests a range from the majors that passed every check, for each
 * Angular package the published code imports.
 */
function missingPeersFinding(versions: VersionReport[], angularImports: string[]): Finding {
  const working = versions.filter((v) => works(v) && !v.prerelease).map((v) => v.major);
  const text = "The package declares no @angular/* peer dependency, so it claims no version and package managers can't warn about a mismatch.";
  if (!working.length) return { level: 'warning', majors: [], text: `${text} No version passed in this run, so there's no range to suggest.` };
  const range = [...new Set(working)].sort((a, b) => a - b).map((m) => `^${m}.0.0`).join(' || ');
  const packages = [...new Set(['@angular/core', ...angularImports])].sort();
  const suggested = Object.fromEntries(packages.map((name) => [name, range]));
  const lines = packages.map((name) => `"${name}": "${range}"`).join(', ');
  return {
    level: 'warning',
    majors: [],
    text: `${text} From the versions that passed: ${lines}.`,
    suggestedPeerDependencies: suggested,
  };
}

export function majorsText(majors: number[]): string {
  const sorted = [...new Set(majors)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return runs.join(', ');
}

// ---------------------------------------------------------------- terminal

const SYMBOL: Record<string, string> = { pass: '✓', fail: '✗', 'not-run': '—', off: '', none: '·' };

function symbol(check: CheckResult): string {
  if (check.status === 'pass' && check.advisory) return '✓?';
  return SYMBOL[check.status];
}

function columns(report: Report): CheckName[] {
  return CHECKS.filter((c) => c !== 'tests' || report.versions.some((v) => v.checks.tests.status !== 'off'));
}

function rowLabel(version: VersionReport): string {
  return version.prerelease ? `Angular ${version.angularVersion}` : `Angular ${version.major}`;
}

function center(text: string, width: number): string {
  const length = [...text].length;
  const left = Math.floor((width - length) / 2);
  return ' '.repeat(Math.max(0, left)) + text + ' '.repeat(Math.max(0, width - length - left));
}

export function headline(report: Report): string {
  const parts: string[] = [];
  if (report.library.compiledWith) parts.push(`compiled with Angular ${report.library.compiledWith}`);
  if (report.library.highestMinVersion) parts.push(`highest minVersion ${report.library.highestMinVersion}`);
  return `${report.library.name}@${report.library.version}${parts.length ? ` (${parts.join('; ')})` : ''}`;
}

export function renderTerminal(report: Report, verbose = false): string {
  const cols = columns(report);
  const labelWidth = Math.max(...report.versions.map((v) => rowLabel(v).length), 10) + 2;
  const widths = cols.map((c) => CHECK_LABELS[c].length + 2);
  const lines = [headline(report), ''];
  lines.push(' '.repeat(labelWidth) + cols.map((c, i) => center(CHECK_LABELS[c], widths[i])).join(''));
  for (const version of report.versions) {
    const cells = version.setupError
      ? cols.map((c, i) => center(c === 'peer' ? symbol(version.checks.peer) : '!', widths[i]))
      : cols.map((c, i) => center(symbol(version.checks[c]), widths[i]));
    lines.push(rowLabel(version).padEnd(labelWidth) + cells.join('').trimEnd());
  }
  if (report.versions.some((v) => v.checks.partial.advisory)) {
    lines.push('', '✓? partial passed on minVersion alone, which has been too low before; the build decides.');
  }
  if (report.findings.length) lines.push('');
  for (const finding of report.findings) {
    const mark = finding.level === 'error' ? '✗' : finding.level === 'warning' ? '!' : '·';
    const where = finding.majors.length ? `${majorsText(finding.majors)}: ` : '';
    lines.push(wrap(`${mark} ${where}${finding.text}`, 88, '  '));
  }
  const failing = report.versions.filter((v) => firstFailure(v) || v.setupError);
  for (const version of failing) {
    const failure = firstFailure(version);
    const errors = version.setupError ? version.setupError.split('\n').slice(1) : (failure?.[1].errorLines ?? []);
    const full = failure?.[1].fullOutput;
    if (!errors.length && !full) continue;
    lines.push('', `${rowLabel(version)}, ${failure ? CHECK_LABELS[failure[0]] : 'setup'}:`);
    if (verbose && full) {
      for (const line of full.split(/\r?\n/)) lines.push(`  ${line}`);
    } else {
      for (const line of errors.slice(0, 6)) lines.push(`  ${line.trim()}`);
    }
  }
  lines.push('', exitSummary(report));
  return lines.join('\n') + '\n';
}

function exitSummary(report: Report): string {
  if (report.exitCode === 2) return "Couldn't check every version; see above.";
  if (report.exitCode === 1) return 'A version the peer range claims is broken.';
  return 'Every version the peer range claims works.';
}

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && (current + ' ' + word).length > width) {
      lines.push(current);
      current = indent + word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

// ---------------------------------------------------------------- markdown

const MD: Record<string, string> = { pass: '✅', fail: '❌', 'not-run': '—', off: '', none: 'n/a' };

export function renderMarkdown(report: Report): string {
  const cols = columns(report);
  const date = report.checkedAt.slice(0, 10);
  const compiled = report.library.compiledWith ? `, compiled with Angular ${report.library.compiledWith}` : '';
  const lines = [
    '## Angular compatibility',
    '',
    `Checked on ${date} for \`${report.library.name}@${report.library.version}\`${compiled}, by installing the packed package into a fresh app of each version with ${report.packageManager} and building it ([angular-compat-matrix](https://github.com/berserker5619/angular-compat-matrix)).`,
    '',
    `| Angular | ${cols.map((c) => CHECK_LABELS[c][0].toUpperCase() + CHECK_LABELS[c].slice(1)).join(' | ')} |`,
    `| :-- | ${cols.map(() => ':-:').join(' | ')} |`,
  ];
  for (const version of report.versions) {
    const cells = cols.map((c) => {
      if (version.setupError && c !== 'peer') return '⚠️';
      const check = version.checks[c];
      return check.status === 'pass' && check.advisory ? '✅*' : MD[check.status];
    });
    lines.push(`| ${version.prerelease ? version.angularVersion : `${version.major} (${version.angularVersion})`} | ${cells.join(' | ')} |`);
  }
  if (report.findings.length) lines.push('');
  for (const finding of report.findings) {
    const mark = finding.level === 'error' ? '❌' : finding.level === 'warning' ? '⚠️' : 'ℹ️';
    const where = finding.majors.length ? `**${majorsText(finding.majors)}:** ` : '';
    lines.push(`- ${mark} ${where}${finding.text}`);
  }
  if (report.versions.some((v) => v.checks.partial.advisory)) {
    lines.push('', '\\* Passed on `minVersion` alone, which has been too low before; the build decides.');
  }
  return lines.join('\n') + '\n';
}

export function renderJson(report: Report, verbose = false): string {
  if (verbose) {
    return JSON.stringify(report, null, 2) + '\n';
  }
  const stripped: Report = {
    ...report,
    versions: report.versions.map((v) => ({
      ...v,
      checks: Object.fromEntries(
        Object.entries(v.checks).map(([name, check]) => {
          const { fullOutput: _full, ...rest } = check;
          return [name, rest];
        }),
      ) as Record<CheckName, CheckResult>,
    })),
  };
  return JSON.stringify(stripped, null, 2) + '\n';
}

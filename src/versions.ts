import semver from 'semver';
import type { Packument, Registry, VersionMeta } from './registry.ts';

/** Everything angular-compat-matrix needs to know about one Angular major, all read from the registry. */
export interface AngularMajor {
  major: number;
  /** The `@angular/core` version an app of this major gets: the latest patch, or the `next` tag. */
  version: string;
  cliVersion: string;
  releasedAt?: string;
  supported: boolean;
  /** `engines.node` of `@angular/core` and `@angular/cli`; Node must satisfy both. */
  nodeRanges: string[];
  /** `@angular/compiler-cli`'s TypeScript peer range. */
  typescriptRange?: string;
  /** `@angular/core`'s peer ranges for RxJS and zone.js. */
  rxjsRange?: string;
  zoneRange?: string;
  prerelease: boolean;
}

/** How long a major is supported after its x.0.0 release: 6 months active, then 12 months LTS. */
export const SUPPORT_MONTHS = 18;

/** Majors older than this are only checked on request, best effort. */
export const OLDEST_DEFAULT_MAJOR = 17;

export function stableVersions(packument: Packument): string[] {
  return Object.keys(packument.versions)
    .filter((v) => semver.valid(v) && !semver.prerelease(v))
    .sort(semver.rcompare);
}

export function latestOfMajor(packument: Packument, major: number): string | undefined {
  return stableVersions(packument).find((v) => semver.major(v) === major);
}

export function majorsOf(packument: Packument): number[] {
  return [...new Set(stableVersions(packument).map((v) => semver.major(v)))].sort((a, b) => a - b);
}

export function isSupported(packument: Packument, major: number, now: Date): boolean {
  const released = packument.time[`${major}.0.0`];
  const newest = Math.max(...majorsOf(packument));
  if (major === newest) return true;
  if (!released) return false;
  const end = new Date(released);
  end.setMonth(end.getMonth() + SUPPORT_MONTHS);
  return now < end;
}

export function supportedMajors(packument: Packument, now: Date): number[] {
  return majorsOf(packument).filter((major) => isSupported(packument, major, now));
}

/** The `next` tag, when it's ahead of `latest`. It may be a minor pre-release, not a new major. */
export function nextVersion(packument: Packument): string | undefined {
  const next = packument['dist-tags'].next;
  const latest = packument['dist-tags'].latest;
  if (!next || !semver.valid(next)) return undefined;
  if (latest && semver.lte(next, latest)) return undefined;
  return next;
}

/** Newest version of a package (pre-releases only when asked) that satisfies a range. */
export function newestSatisfying(packument: Packument, range: string, includePrerelease = false): string | undefined {
  return Object.keys(packument.versions)
    .filter((v) => semver.valid(v) && (includePrerelease || !semver.prerelease(v)))
    .sort(semver.rcompare)
    .find((v) => semver.satisfies(v, range, { includePrerelease: true }));
}

export interface VersionSources {
  core: Packument;
  cli: Packument;
  compilerCli: Packument;
}

export async function loadVersionSources(registry: Registry): Promise<VersionSources> {
  const [core, cli, compilerCli] = await Promise.all([
    registry.get('@angular/core'),
    registry.get('@angular/cli'),
    registry.get('@angular/compiler-cli'),
  ]);
  return { core, cli, compilerCli };
}

export function describeMajor(sources: VersionSources, major: number, now: Date, useNext?: string): AngularMajor {
  const version = useNext && semver.major(useNext) === major ? useNext : latestOfMajor(sources.core, major);
  if (!version) throw new Error(`Angular ${major} isn't published on npm.`);
  const prerelease = Boolean(semver.prerelease(version));
  const cliVersion =
    (prerelease ? sameOrNewestPrerelease(sources.cli, version) : latestOfMajor(sources.cli, major)) ?? version;
  const compilerVersion = sources.compilerCli.versions[version] ? version : latestOfMajor(sources.compilerCli, major);
  const coreMeta: VersionMeta = sources.core.versions[version];
  const cliMeta: VersionMeta | undefined = sources.cli.versions[cliVersion];
  const compilerMeta = compilerVersion ? sources.compilerCli.versions[compilerVersion] : undefined;
  const nodeRanges = [coreMeta.engines?.node, cliMeta?.engines?.node].filter((r): r is string => Boolean(r));
  return {
    major,
    version,
    cliVersion,
    releasedAt: sources.core.time[`${major}.0.0`],
    supported: isSupported(sources.core, major, now),
    nodeRanges,
    typescriptRange: compilerMeta?.peerDependencies?.typescript,
    rxjsRange: coreMeta.peerDependencies?.rxjs,
    zoneRange: coreMeta.peerDependencies?.['zone.js'],
    prerelease,
  };
}

function sameOrNewestPrerelease(packument: Packument, version: string): string | undefined {
  if (packument.versions[version]) return version;
  const major = semver.major(version);
  return Object.keys(packument.versions)
    .filter((v) => semver.valid(v) && semver.major(v) === major)
    .sort(semver.rcompare)[0];
}

/** Parses `--versions`: `22`, `18-22`, `20,22`, or a mix. */
export function parseVersionList(text: string): number[] {
  const majors = new Set<number>();
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
      for (let m = from; m <= to; m++) majors.add(m);
    } else if (/^\d+$/.test(part)) {
      majors.add(Number(part));
    } else {
      throw new Error(`--versions: "${part}" isn't a major or a range like 18-22`);
    }
  }
  return [...majors].sort((a, b) => a - b);
}

/**
 * Default majors: the supported ones, plus every major the package's `@angular/core` range claims
 * (back to Angular 17), plus the newest, so "works but not claimed" shows up.
 */
export function defaultMajors(core: Packument, coreRange: string | undefined, now: Date): number[] {
  const all = majorsOf(core);
  const chosen = new Set(supportedMajors(core, now));
  chosen.add(Math.max(...all));
  if (coreRange) {
    for (const major of all) {
      if (major < OLDEST_DEFAULT_MAJOR) continue;
      const version = latestOfMajor(core, major);
      if (version && claimsMajor(coreRange, major, version)) chosen.add(major);
    }
  }
  return [...chosen].sort((a, b) => a - b);
}

function claimsMajor(range: string, major: number, latest: string): boolean {
  try {
    return (
      semver.satisfies(latest, range, { includePrerelease: true }) ||
      semver.intersects(range, `>=${major}.0.0 <${major + 1}.0.0-0`, { includePrerelease: true })
    );
  } catch {
    return false;
  }
}

/** Whether this Node can run a major, reading `engines` as minimums (they have no upper bound). */
export function nodeSatisfies(node: string, ranges: string[]): boolean {
  return ranges.every((range) => semver.satisfies(node, range, { includePrerelease: true }));
}

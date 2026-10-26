import semver from 'semver';
import type { Packument, Registry } from './registry.ts';
import { newestSatisfying } from './versions.ts';

/** Packages released in lockstep with `@angular/core`: same version number, always. */
export const FRAMEWORK = new Set([
  '@angular/animations',
  '@angular/common',
  '@angular/compiler',
  '@angular/compiler-cli',
  '@angular/core',
  '@angular/elements',
  '@angular/forms',
  '@angular/language-service',
  '@angular/localize',
  '@angular/platform-browser',
  '@angular/platform-browser-dynamic',
  '@angular/platform-server',
  '@angular/router',
  '@angular/service-worker',
  '@angular/upgrade',
]);

/** Peers a generated app already has at the right version, so they're never installed again. */
const APP_PROVIDED = new Set(['rxjs', 'tslib', 'zone.js', 'typescript']);

export interface LibraryManifest {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export interface PeerMiss {
  name: string;
  range: string;
  version: string;
}

export interface PeerPlan {
  /** Whether the package claims this Angular version: null when it declares no `@angular/*` peer. */
  claimed: boolean | null;
  misses: PeerMiss[];
  /** Peers to install next to the package, at the version a real app of this Angular would have. */
  installs: Record<string, string>;
  /** Every `@angular/*` peer and the version it's checked against. */
  checked: Record<string, string>;
}

function isOptional(manifest: LibraryManifest, name: string): boolean {
  return Boolean(manifest.peerDependenciesMeta?.[name]?.optional);
}

/**
 * The newest version of a non-framework peer (Angular Material, the CDK, a third-party package)
 * that a real app on this Angular would use: one whose own `@angular/*` peers accept it,
 * preferring versions the library's range allows.
 */
export function pickPeerVersion(packument: Packument, libraryRange: string, angularVersion: string): string | undefined {
  const pre = Boolean(semver.prerelease(angularVersion));
  const candidates = Object.keys(packument.versions)
    .filter((v) => semver.valid(v) && (pre || !semver.prerelease(v)))
    .sort(semver.rcompare);
  const acceptsAngular = (v: string) => {
    const peers = packument.versions[v].peerDependencies ?? {};
    const framework = Object.entries(peers).filter(([name]) => FRAMEWORK.has(name));
    return framework.every(([, range]) => semver.satisfies(angularVersion, range, { includePrerelease: true }));
  };
  const inRange = (v: string) => semver.satisfies(v, libraryRange, { includePrerelease: true });
  const hasFrameworkPeer = (v: string) =>
    Object.keys(packument.versions[v].peerDependencies ?? {}).some((name) => FRAMEWORK.has(name));
  // Packages that don't depend on Angular (say, a date library) just follow the library's range.
  if (!candidates.some(hasFrameworkPeer)) return candidates.find(inRange) ?? newestSatisfying(packument, '*');
  return (
    candidates.find((v) => acceptsAngular(v) && inRange(v)) ??
    candidates.find(acceptsAngular) ??
    candidates.find(inRange)
  );
}

export async function planPeers(manifest: LibraryManifest, angularVersion: string, registry: Registry): Promise<PeerPlan> {
  const peers = manifest.peerDependencies ?? {};
  const installs: Record<string, string> = {};
  const checked: Record<string, string> = {};
  const misses: PeerMiss[] = [];
  let angularPeers = 0;

  for (const [name, range] of Object.entries(peers)) {
    let version: string | undefined;
    if (FRAMEWORK.has(name)) {
      version = angularVersion;
      installs[name] = angularVersion;
    } else if (!APP_PROVIDED.has(name)) {
      version = pickPeerVersion(await registry.get(name), range, angularVersion);
      if (version) installs[name] = version;
    }
    // Optional peers are installed (the smoke app imports every entry point, and some entry point
    // needs them, as angular-calendar's date-fns adapter needs date-fns) but claim nothing.
    if (!name.startsWith('@angular/') || isOptional(manifest, name)) continue;
    angularPeers++;
    const against = version ?? 'none';
    checked[name] = against;
    if (!version || !semver.satisfies(version, range, { includePrerelease: true })) {
      misses.push({ name, range, version: against });
    }
  }
  return { claimed: angularPeers ? misses.length === 0 : null, misses, installs, checked };
}

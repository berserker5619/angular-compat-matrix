import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface VersionMeta {
  version: string;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

/** The parts of a registry document angular-compat-matrix uses; everything else is dropped before caching. */
export interface Packument {
  name: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, VersionMeta>;
  time: Record<string, string>;
}

export interface RegistryOptions {
  cacheDir: string;
  /** Use only cached answers, however old. */
  offline?: boolean;
  /** Read recorded answers from this folder instead of the network (tests). */
  recordedDir?: string;
  registryUrl?: string;
  maxAgeMs?: number;
  /** Per request; each request is tried twice. */
  timeoutMs?: number;
}

const DAY = 24 * 60 * 60 * 1000;

const FULL_DOCUMENT = new Set(['@angular/core']);

export class Registry {
  private readonly memory = new Map<string, Promise<Packument>>();
  private readonly options: RegistryOptions;

  constructor(options: RegistryOptions) {
    this.options = options;
  }

  get(name: string): Promise<Packument> {
    let pending = this.memory.get(name);
    if (!pending) {
      pending = this.load(name);
      this.memory.set(name, pending);
    }
    return pending;
  }

  private async load(name: string): Promise<Packument> {
    const file = `${encodeURIComponent(name)}.json`;
    if (this.options.recordedDir) {
      const path = join(this.options.recordedDir, file);
      if (!existsSync(path)) throw new Error(`No recorded registry answer for ${name} (${path})`);
      return JSON.parse(readFileSync(path, 'utf8')) as Packument;
    }
    const dir = join(this.options.cacheDir, 'registry');
    const path = join(dir, file);
    const cached = readCached(path);
    const maxAge = this.options.maxAgeMs ?? DAY;
    if (cached && (this.options.offline || Date.now() - cached.fetchedAt < maxAge)) return cached.packument;
    if (this.options.offline) throw new Error(`--offline: ${name} isn't in the registry cache yet. Run once online first.`);

    const base = (this.options.registryUrl ?? process.env.npm_config_registry ?? 'https://registry.npmjs.org/').replace(
      /\/?$/,
      '/',
    );
    const url = base + name.replace('/', '%2f');
    // Only @angular/core's publish dates are needed (to tell which majors are supported); everything
    // else comes from the abbreviated document, which is much smaller for packages with many versions.
    const accept = FULL_DOCUMENT.has(name)
      ? 'application/json'
      : 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8';
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    let packument: Packument | undefined;
    let problem = '';
    // Two tries: one dropped connection shouldn't end a run that takes minutes.
    for (let attempt = 1; attempt <= 2 && !packument; attempt++) {
      try {
        const response = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(timeoutMs) });
        if (response.status === 404) throw new RegistryError(`${name} isn't on the npm registry (${base}).`);
        if (!response.ok) {
          problem = `it answered ${response.status} ${response.statusText}`;
          continue;
        }
        packument = trim((await response.json()) as Packument);
      } catch (error) {
        if (error instanceof RegistryError) throw error;
        problem = describeFetchError(error as Error, timeoutMs);
      }
    }
    if (!packument) {
      if (cached) return cached.packument;
      throw new RegistryError(`Couldn't get ${name} from the npm registry (${base}): ${problem}.`);
    }
    writeCached(dir, path, packument);
    return packument;
  }
}

export class RegistryError extends Error {}

function describeFetchError(error: Error, timeoutMs: number): string {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return `no answer within ${timeoutMs / 1000} s`;
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'the host name could not be resolved (are you offline?)';
  if (code === 'ECONNREFUSED') return 'the connection was refused';
  if (code === 'ECONNRESET') return 'the connection was reset';
  return cause?.message ?? error.message;
}

/** A cache entry, or nothing when it's missing or unreadable (a crashed write, a full disk): it's refetched. */
function readCached(path: string): { fetchedAt: number; packument: Packument } | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const entry = JSON.parse(readFileSync(path, 'utf8')) as { fetchedAt?: unknown; packument?: Packument };
    if (typeof entry.fetchedAt === 'number' && entry.packument && typeof entry.packument.versions === 'object') {
      return entry as { fetchedAt: number; packument: Packument };
    }
  } catch {
    // fall through
  }
  rmSync(path, { force: true });
  return undefined;
}

/** Writes through a temporary file, so a crash or a full disk never leaves a half-written entry. */
function writeCached(dir: string, path: string, packument: Packument): void {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, JSON.stringify({ fetchedAt: Date.now(), packument }));
    renameSync(tmp, path);
  } catch {
    // Caching is an optimisation; the run goes on without it.
    rmSync(tmp, { force: true });
  }
}

export function trim(raw: Packument): Packument {
  const versions: Record<string, VersionMeta> = {};
  for (const [version, meta] of Object.entries(raw.versions ?? {})) {
    const kept: VersionMeta = { version };
    if (meta.peerDependencies) kept.peerDependencies = meta.peerDependencies;
    if (meta.peerDependenciesMeta) kept.peerDependenciesMeta = meta.peerDependenciesMeta;
    if (meta.dependencies) kept.dependencies = meta.dependencies;
    if (meta.engines && typeof meta.engines === 'object') kept.engines = meta.engines;
    versions[version] = kept;
  }
  const time: Record<string, string> = {};
  for (const version of Object.keys(versions)) if (raw.time?.[version]) time[version] = raw.time[version];
  return { name: raw.name, 'dist-tags': raw['dist-tags'] ?? {}, versions, time };
}

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface VersionMeta {
  version: string;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

/** The parts of a registry document ng-matrix uses; everything else is dropped before caching. */
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
    const cached = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as { fetchedAt: number; packument: Packument })
      : undefined;
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
    let response: Response;
    try {
      response = await fetch(url, { headers: { accept } });
    } catch (error) {
      if (cached) return cached.packument;
      throw new Error(`Couldn't reach the npm registry for ${name}: ${(error as Error).message}`);
    }
    if (!response.ok) {
      if (cached) return cached.packument;
      throw new Error(`The npm registry answered ${response.status} for ${name}`);
    }
    const packument = trim((await response.json()) as Packument);
    mkdirSync(dir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ fetchedAt: Date.now(), packument }));
    renameSync(tmp, path);
    return packument;
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

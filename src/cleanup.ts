import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killAllChildren } from './exec.ts';

/*
 * Temporary apps and half-written cache entries must not outlive a run, however it ends:
 * normally, with Ctrl+C, or killed outright. Each work folder records the pid that owns it,
 * and each cache write goes through `<name>.<pid>.tmp`, so whatever a dead run left behind
 * can be told apart from what a running one is still using.
 */

const PREFIX = 'ng-matrix-';
const OWNER = '.ng-matrix-pid';

export function createWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), PREFIX));
  writeFileSync(join(dir, OWNER), String(process.pid));
  return dir;
}

export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function removeDir(dir: string): void {
  // On Windows a just-killed build can hold files open for a moment.
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Removes work folders whose run is gone. Folders without an owner file (0.1.0) go after a day. */
export function sweepWorkDirs(base = tmpdir()): string[] {
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(base).filter((name) => name.startsWith(PREFIX));
  } catch {
    return removed;
  }
  for (const name of entries) {
    const dir = join(base, name);
    try {
      const owner = join(dir, OWNER);
      const stale = existsSync(owner)
        ? !isAlive(Number(readFileSync(owner, 'utf8')))
        : Date.now() - statSync(dir).mtimeMs > 24 * 60 * 60 * 1000;
      if (stale) {
        removeDir(dir);
        removed.push(dir);
      }
    } catch {
      // Not ours to judge, or already gone.
    }
  }
  return removed;
}

/** Removes `<name>.<pid>.tmp` entries in the cache left by runs that are gone. */
export function sweepCache(cacheDir: string): string[] {
  const removed: string[] = [];
  for (const sub of ['tools', 'registry']) {
    const dir = join(cacheDir, sub);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const match = /\.(\d+)\.tmp$/.exec(name);
      if (!match || isAlive(Number(match[1]))) continue;
      try {
        removeDir(join(dir, name));
        removed.push(join(dir, name));
      } catch {
        // Try again next run.
      }
    }
  }
  return removed;
}

/**
 * On Ctrl+C (or SIGTERM, or a closed terminal): stop every child, remove the work folder unless
 * --keep, and exit. A second Ctrl+C exits at once.
 */
export function cleanUpOnInterrupt(workDir: string, keep: boolean, log: (line: string) => void): () => void {
  let stopping = false;
  const handler = (signal: NodeJS.Signals) => {
    if (stopping) process.exit(130);
    stopping = true;
    log(`Interrupted (${signal}): stopping, then ${keep ? `keeping ${workDir} (--keep)` : `removing ${workDir}`}.`);
    killAllChildren();
    if (!keep) {
      try {
        removeDir(workDir);
      } catch (error) {
        log(`Couldn't remove ${workDir}: ${(error as Error).message}. The next run removes it.`);
      }
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const signals: NodeJS.Signals[] = process.platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, handler);
  return () => {
    for (const signal of signals) process.off(signal, handler);
  };
}

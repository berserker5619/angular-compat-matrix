import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Run `command` through the shell, for commands an author typed (`--build`, `--test-command`). */
  shell?: boolean;
}

export interface ExecResult {
  code: number;
  /** stdout and stderr interleaved, in the order they arrived, without ANSI colours. */
  output: string;
  durationMs: number;
  timedOut: boolean;
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** Environment every child gets: no prompts, no analytics, no colour codes to strip later. */
export function quietEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NG_CLI_ANALYTICS: 'false',
    NG_DISABLE_VERSION_CHECK: '1',
    NO_UPDATE_NOTIFIER: '1',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_AUDIT: 'false',
    FORCE_COLOR: '0',
    ...extra,
  };
}

/** Every child still running, so an interrupt can stop them all. */
const running = new Set<ChildProcess>();

/** Stops every running child and everything it started (npm, then the build it runs). */
export function killAllChildren(): void {
  for (const child of running) killTree(child.pid);
  running.clear();
}

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

export function exec(command: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  const started = Date.now();
  if (verboseEnabled) {
    const fullCmd = options.shell ? [command, ...args].join(' ') : `${command} ${args.join(' ')}`;
    process.stderr.write(`[angular-compat-matrix] > ${fullCmd}\n`);
  }
  return new Promise((resolve) => {
    // On Linux and macOS each child leads its own process group, so killing the group stops
    // its children too. Windows has taskkill /T for that.
    const detached = process.platform !== 'win32';
    const child = options.shell
      ? spawn([command, ...args].join(' '), { cwd: options.cwd, env: options.env ?? quietEnv(), shell: true, detached })
      : spawn(command, args, { cwd: options.cwd, env: options.env ?? quietEnv(), detached });
    running.add(child);
    let output = '';
    let timedOut = false;
    const append = (chunk: Buffer) => (output += chunk.toString('utf8'));
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
        }, options.timeoutMs)
      : undefined;
    const finish = (code: number) => {
      running.delete(child);
      if (timer) clearTimeout(timer);
      resolve({ code, output: stripAnsi(output), durationMs: Date.now() - started, timedOut });
    };
    child.on('error', (error) => {
      output += `\n${error.message}`;
      finish(127);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}

/**
 * npm's own CLI script, so npm runs as `node npm-cli.js` without a shell
 * (spawning `npm.cmd` on Windows needs one, and then every argument needs quoting).
 */
export function npmCli(): string[] {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (candidate && /npm-cli\.js$/.test(candidate) && existsSync(candidate)) return [process.execPath, candidate];
  }
  throw new Error("Couldn't find npm next to this Node. angular-compat-matrix needs the npm that ships with Node.");
}

export function npm(args: string[], options: ExecOptions): Promise<ExecResult> {
  const [node, cli] = npmCli();
  return exec(node, [cli, ...args], options);
}

/** The first lines that look like errors, with a little context, for reports. */
export function errorLines(output: string, max = 12): string[] {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd());
  // Errors first; warnings (Angular prints NG8113 "not used" ones, say) only when there's nothing else.
  const errors = /(\[ERROR\]|\berror TS\d+|\bERR_PNPM_|npm error|^\s*Error:|✘|✕|^\s*X |\berror NG\d{4}\b|ERESOLVE|unmet peer|invalid: )/i;
  const anything = /(\[WARNING\]|\bNG\d{4}\b|\bwarn)/i;
  for (const marker of [errors, anything]) {
    const picked: string[] = [];
    for (let i = 0; i < lines.length && picked.length < max; i++) {
      if (!marker.test(lines[i])) continue;
      for (let j = i; j < Math.min(lines.length, i + 6) && picked.length < max; j++) {
        const line = lines[j];
        if (j > i && (errors.test(line) || anything.test(line)) && !marker.test(line)) break;
        if (line.trim() && !picked.includes(line)) picked.push(line);
      }
      i += 5;
    }
    if (picked.length) return picked;
  }
  return lines.filter((line) => line.trim()).slice(-max);
}

/** How long any one step (ng new, an install, a build, the tests) may take: --step-timeout. */
let stepTimeoutMs = 20 * 60_000;

export function setStepTimeout(ms: number): void {
  stepTimeoutMs = ms;
}

export function stepTimeout(): number {
  return stepTimeoutMs;
}

/**
 * Why a step failed when it's the machine's fault, not the package's: it timed out, the disk is
 * full, or the network dropped. Such a version is reported as not checked (exit 2), not as failing.
 */
export function environmentProblem(result: Pick<ExecResult, 'output' | 'timedOut'>): string | undefined {
  if (result.timedOut) return `timed out after ${formatMinutes(stepTimeoutMs)} (raise the limit with --step-timeout <minutes>)`;
  if (/\bENOSPC\b|no space left on device|not enough space on the disk/i.test(result.output)) {
    return 'the disk is full (ENOSPC). Free some space, or point TMPDIR/TEMP and ANGULAR_COMPAT_MATRIX_CACHE somewhere with room';
  }
  const network = /^.*\b(EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ERR_PNPM_META_FETCH_FAIL|socket hang up)\b.*$/im.exec(
    result.output,
  );
  if (network) return `a network error: ${network[0].trim().slice(0, 200)}`;
  return undefined;
}

function formatMinutes(ms: number): string {
  const minutes = ms / 60_000;
  return minutes >= 1 ? `${Number(minutes.toFixed(1))} min` : `${Math.round(ms / 1000)} s`;
}

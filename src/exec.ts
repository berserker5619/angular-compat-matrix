import { spawn, spawnSync } from 'node:child_process';
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

export function exec(command: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = options.shell
      ? spawn([command, ...args].join(' '), { cwd: options.cwd, env: options.env ?? quietEnv(), shell: true })
      : spawn(command, args, { cwd: options.cwd, env: options.env ?? quietEnv() });
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
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
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
  throw new Error("Couldn't find npm next to this Node. ng-matrix needs the npm that ships with Node.");
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

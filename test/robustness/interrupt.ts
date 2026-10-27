// Ctrl+C mid-install and mid-build: the run must exit 130, leave no work folder and no running
// child processes behind, and the next run must work. On Linux and macOS the run gets SIGINT; on
// Windows it runs in a console of its own and gets a real Ctrl+C there (ctrl-c.ps1).
//
//   node test/robustness/interrupt.ts
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'dist', 'cli.js');
const fixture = join(root, 'fixtures', 'libs', 'healthy');
const windows = process.platform === 'win32';

/** Processes whose command line points into an angular-compat-matrix work folder. */
function leftoverProcesses(): string[] {
  const out = windows
    ? execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'], {
        encoding: 'utf8',
      })
    : execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => /ng-matrix-[A-Za-z0-9]{6}[\\/]/.test(line));
}

async function interruptAt(step: string): Promise<{ code: number | null; log: string }> {
  if (windows) {
    const log = join(tmpdir(), `ngm-ctrl-c-${process.pid}.log`);
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(import.meta.dirname, 'ctrl-c.ps1'), '-Node', process.execPath, '-Cli', cli, '-Cwd', fixture, '-Step', step, '-Log', log],
      { encoding: 'utf8' },
    );
    const text = readFileSync(log, 'utf8');
    rmSync(log, { force: true });
    rmSync(`${log}.out`, { force: true });
    return { code: Number(/exit=(-?\d+)/.exec(out)?.[1] ?? NaN), log: text };
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, '--versions', '22', '--pm', 'npm'], { cwd: fixture });
    let log = '';
    let sent = false;
    child.stderr.on('data', (chunk: Buffer) => {
      log += chunk;
      if (!sent && new RegExp(step).test(log)) {
        sent = true;
        // Give the step a moment to really start (npm resolving, the compiler running).
        setTimeout(() => child.kill('SIGINT'), step.includes('AOT') ? 1000 : 3000);
      }
    });
    child.on('close', (code) => resolve({ code, log }));
  });
}

for (const [label, step] of [
  ['install', 'installing ngm-fixture-healthy'],
  ['build', 'AOT build'],
] as const) {
  const { code, log } = await interruptAt(step);
  assert.equal(code, 130, `Ctrl+C during ${label}: exit code\n${log}`);
  // The run names its work folder as it stops; other angular-compat-matrix runs on the machine are left alone.
  const workDir = /Interrupted \(SIG(?:INT|BREAK)\): stopping, then removing (.+)\.\s*$/m.exec(log)?.[1];
  assert.ok(workDir, `Ctrl+C during ${label}: the run said so\n${log}`);
  assert.ok(!existsSync(workDir), `Ctrl+C during ${label}: ${workDir} left behind`);
  await new Promise((r) => setTimeout(r, 1500));
  const name = basename(workDir);
  assert.deepEqual(leftoverProcesses().filter((line) => line.includes(name)), [], `Ctrl+C during ${label}: processes left running`);
  console.log(`✓ Ctrl+C during ${label}: exit 130, no work folder or processes left behind`);
}

// The next run works: no half-written cache entry trips it up.
const next = spawn(process.execPath, [cli, '--versions', '22', '--pm', 'npm', '--format', 'json'], {
  cwd: fixture,
  stdio: ['ignore', 'pipe', 'ignore'],
});
let json = '';
next.stdout.on('data', (chunk: Buffer) => (json += chunk));
const code = await new Promise((resolve) => next.on('close', resolve));
assert.equal(code, 0, 'the run after the interrupts');
assert.equal(JSON.parse(json).versions[0].checks.strict.status, 'pass');
console.log('✓ the next run works');

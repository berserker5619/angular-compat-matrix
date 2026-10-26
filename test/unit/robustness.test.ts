import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { sweepCache, sweepWorkDirs } from '../../src/cleanup.ts';
import { environmentProblem, setStepTimeout } from '../../src/exec.ts';
import { packFailure } from '../../src/library.ts';
import { Registry, RegistryError } from '../../src/registry.ts';
import { isComplete } from '../../src/tools.ts';

const root = mkdtempSync(join(tmpdir(), 'ngm-robust-'));
after(() => rmSync(root, { recursive: true, force: true }));

function serve(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; server: Server }> {
  const server = createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, server })),
  );
}

const packument = { name: 'some-lib', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { version: '1.0.0' } }, time: {} };

describe('registry', () => {
  it('gives up on a registry that never answers, with a clear message', async () => {
    const { url, server } = await serve(() => {}); // accepts, never responds
    try {
      const registry = new Registry({ cacheDir: join(root, 'hang'), registryUrl: url, timeoutMs: 300 });
      const started = Date.now();
      await assert.rejects(registry.get('some-lib'), (error: Error) => {
        assert.ok(error instanceof RegistryError);
        assert.match(error.message, /Couldn't get some-lib from the npm registry \(http:\/\/127\.0\.0\.1:\d+\/\): no answer within 0\.3 s\./);
        return true;
      });
      assert.ok(Date.now() - started < 5000, 'two tries of 0.3 s, not a hang');
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('says so when the registry refuses the connection', async () => {
    const { url, server } = await serve(() => {});
    server.close(); // nothing listens on that port any more
    const registry = new Registry({ cacheDir: join(root, 'refused'), registryUrl: url, timeoutMs: 2000 });
    await assert.rejects(registry.get('some-lib'), /the connection was refused/);
  });

  it('says a package is missing instead of retrying', async () => {
    const { url, server } = await serve((_req, res) => res.writeHead(404).end('{}'));
    try {
      const registry = new Registry({ cacheDir: join(root, 'missing'), registryUrl: url });
      await assert.rejects(registry.get('no-such-lib'), /no-such-lib isn't on the npm registry/);
    } finally {
      server.close();
    }
  });

  it('refetches a corrupt cache entry instead of crashing', async () => {
    const cacheDir = join(root, 'corrupt');
    mkdirSync(join(cacheDir, 'registry'), { recursive: true });
    const entry = join(cacheDir, 'registry', 'some-lib.json');
    writeFileSync(entry, '{"fetchedAt": 17, "packu'); // a write cut short
    const { url, server } = await serve((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(packument)));
    try {
      const got = await new Registry({ cacheDir, registryUrl: url }).get('some-lib');
      assert.deepEqual(Object.keys(got.versions), ['1.0.0']);
      assert.equal(JSON.parse(readFileSync(entry, 'utf8')).packument.name, 'some-lib');
    } finally {
      server.close();
    }
  });
});

describe('cache and temp folders', () => {
  it('removes work folders whose run is gone, and leaves live ones', () => {
    const base = join(root, 'tmp');
    mkdirSync(join(base, 'ng-matrix-dead'), { recursive: true });
    writeFileSync(join(base, 'ng-matrix-dead', '.ng-matrix-pid'), '999999');
    mkdirSync(join(base, 'ng-matrix-live'), { recursive: true });
    writeFileSync(join(base, 'ng-matrix-live', '.ng-matrix-pid'), String(process.pid));
    mkdirSync(join(base, 'ng-matrix-old-0.1'), { recursive: true }); // 0.1.0 wrote no owner file
    const twoDaysAgo = (Date.now() - 2 * 24 * 3600 * 1000) / 1000;
    utimesSync(join(base, 'ng-matrix-old-0.1'), twoDaysAgo, twoDaysAgo);
    mkdirSync(join(base, 'something-else'), { recursive: true });
    sweepWorkDirs(base);
    assert.ok(!existsSync(join(base, 'ng-matrix-dead')));
    assert.ok(!existsSync(join(base, 'ng-matrix-old-0.1')));
    assert.ok(existsSync(join(base, 'ng-matrix-live')));
    assert.ok(existsSync(join(base, 'something-else')));
  });

  it("removes half-written cache entries left by a run that's gone", () => {
    const cacheDir = join(root, 'cache-sweep');
    mkdirSync(join(cacheDir, 'tools', '@angular+cli@22.2.4.999999.tmp'), { recursive: true });
    mkdirSync(join(cacheDir, 'tools', `pnpm@12.15.0.${process.pid}.tmp`), { recursive: true });
    mkdirSync(join(cacheDir, 'registry'), { recursive: true });
    writeFileSync(join(cacheDir, 'registry', 'x.json.999999.tmp'), '{');
    sweepCache(cacheDir);
    assert.ok(!existsSync(join(cacheDir, 'tools', '@angular+cli@22.2.4.999999.tmp')));
    assert.ok(!existsSync(join(cacheDir, 'registry', 'x.json.999999.tmp')));
    assert.ok(existsSync(join(cacheDir, 'tools', `pnpm@12.15.0.${process.pid}.tmp`)), 'still being written by this process');
  });

  it('treats a tool with a damaged package.json or a missing bin as not installed', () => {
    const tool = join(root, 'tool');
    mkdirSync(join(tool, 'bin'), { recursive: true });
    writeFileSync(join(tool, 'package.json'), '{"name":"t","bin":{"t":"bin/t.js"}}');
    assert.equal(isComplete(tool), false);
    writeFileSync(join(tool, 'bin', 't.js'), '');
    assert.equal(isComplete(tool), true);
    writeFileSync(join(tool, 'package.json'), '{"name":"t","bin');
    assert.equal(isComplete(tool), false);
  });
});

describe("the machine's fault, not the package's", () => {
  it('names a timeout with the limit and how to raise it', () => {
    setStepTimeout(20 * 60_000);
    assert.equal(environmentProblem({ output: '', timedOut: true }), 'timed out after 20 min (raise the limit with --step-timeout <minutes>)');
    setStepTimeout(6_000);
    assert.match(environmentProblem({ output: '', timedOut: true })!, /timed out after 6 s/);
    setStepTimeout(20 * 60_000);
  });

  it('spots a full disk and a dropped network', () => {
    assert.match(environmentProblem({ output: 'npm error code ENOSPC\nnpm error syscall write', timedOut: false })!, /the disk is full/);
    assert.match(
      environmentProblem({ output: 'npm error request to https://registry.npmjs.org/x failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org', timedOut: false })!,
      /^a network error: .*EAI_AGAIN/,
    );
    assert.equal(environmentProblem({ output: "X [ERROR] TS2322: Type 'string' is not assignable", timedOut: false }), undefined);
  });

  it('explains a package or version that does not exist', () => {
    assert.equal(packFailure('no-such-lib-xyz', 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/no-such-lib-xyz'), "There's no package no-such-lib-xyz on the npm registry.");
    assert.equal(packFailure('@scope/no-such@1.0.0', 'npm error code E404'), "There's no package @scope/no-such on the npm registry.");
    assert.equal(packFailure('ngx-toastr@99.0.0', 'npm error code ETARGET\nnpm error notarget No matching version found for ngx-toastr@99.0.0.'), "ngx-toastr@99.0.0 doesn't match any published version.");
  });
});

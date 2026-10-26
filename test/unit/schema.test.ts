import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type CheckResult,
  type Finding,
  type Report,
  SCHEMA_VERSION,
  type VersionReport,
} from '../../src/model.ts';
import { renderJson } from '../../src/report.ts';

describe('JSON schema contract', () => {
  it('schemaVersion is 1', () => {
    assert.equal(SCHEMA_VERSION, 1);
  });

  const EXPECTED_REPORT_KEYS = [
    'checkedAt',
    'exitCode',
    'findings',
    'installScripts',
    'library',
    'node',
    'packageManager',
    'schemaVersion',
    'tool',
    'versions',
  ];

  const EXPECTED_TOOL_KEYS = ['name', 'version'];

  const EXPECTED_LIBRARY_KEYS = [
    'compiledWith',
    'declarations',
    'highestMinVersion',
    'highestMinVersionIn',
    'name',
    'source',
    'version',
  ];

  const EXPECTED_VERSION_KEYS = [
    'angularVersion',
    'appDir',
    'checks',
    'claimed',
    'dtsErrors',
    'durationMs',
    'major',
    'omittedEntryPoints',
    'peerMisses',
    'prerelease',
    'setupError',
    'skippedInstallScripts',
    'supported',
  ];

  // Default output (non-verbose): fullOutput is omitted, errorLines is always present
  const EXPECTED_CHECK_KEYS_DEFAULT = [
    'advisory',
    'durationMs',
    'errorLines',
    'hint',
    'message',
    'status',
  ];

  // Verbose output: fullOutput is optionally included alongside errorLines
  const EXPECTED_CHECK_KEYS_VERBOSE = [
    'advisory',
    'durationMs',
    'errorLines',
    'fullOutput',
    'hint',
    'message',
    'status',
  ];

  const EXPECTED_FINDING_KEYS = [
    'level',
    'majors',
    'suggestedPeerDependencies',
    'text',
  ];

  it('fails if any field is added or removed from Report without updating schemaVersion', () => {
    const sampleCheck: CheckResult = {
      status: 'fail',
      advisory: false,
      message: 'test message',
      errorLines: ['error line 1'],
      fullOutput: 'full output',
      hint: 'test hint',
      durationMs: 100,
    };

    const sampleVersion: VersionReport = {
      major: 22,
      angularVersion: '22.0.0',
      supported: true,
      prerelease: false,
      claimed: true,
      peerMisses: [{ name: '@angular/core', range: '^22.0.0', version: '22.0.0' }],
      checks: {
        peer: sampleCheck,
        install: sampleCheck,
        partial: sampleCheck,
        aot: sampleCheck,
        strict: sampleCheck,
        tests: sampleCheck,
      },
      setupError: 'setup error',
      skippedInstallScripts: ['esbuild'],
      omittedEntryPoints: [{ entry: 'foo/bar', missingPackage: 'baz' }],
      dtsErrors: false,
      durationMs: 1000,
      appDir: '/tmp/app',
    };

    const sampleFinding: Finding = {
      level: 'warning',
      majors: [22],
      text: 'warning text',
      suggestedPeerDependencies: { '@angular/core': '^22.0.0' },
    };

    const sampleReport: Report = {
      schemaVersion: SCHEMA_VERSION,
      tool: { name: 'angular-compat-matrix', version: '0.1.0' },
      checkedAt: '2026-10-26T10:00:00.000Z',
      library: {
        name: 'test-lib',
        version: '1.0.0',
        source: 'package',
        compiledWith: '22.0.0',
        highestMinVersion: '22.0.0',
        highestMinVersionIn: 'component (test.ts)',
        declarations: 5,
      },
      packageManager: 'npm',
      installScripts: 'toolchain-only',
      node: 'v24.19.0',
      versions: [sampleVersion],
      findings: [sampleFinding],
      exitCode: 0,
    };

    assert.deepEqual(Object.keys(sampleReport).sort(), EXPECTED_REPORT_KEYS);
    assert.deepEqual(Object.keys(sampleReport.tool).sort(), EXPECTED_TOOL_KEYS);
    assert.deepEqual(Object.keys(sampleReport.library).sort(), EXPECTED_LIBRARY_KEYS);
    assert.deepEqual(Object.keys(sampleReport.versions[0]).sort(), EXPECTED_VERSION_KEYS);
    assert.deepEqual(Object.keys(sampleReport.findings[0]).sort(), EXPECTED_FINDING_KEYS);

    // Default JSON output: fullOutput is omitted
    const defaultJson = JSON.parse(renderJson(sampleReport, false)) as Report;
    assert.deepEqual(Object.keys(defaultJson.versions[0].checks.aot).sort(), EXPECTED_CHECK_KEYS_DEFAULT);
    assert.equal(defaultJson.versions[0].checks.aot.fullOutput, undefined);
    assert.deepEqual(defaultJson.versions[0].checks.aot.errorLines, ['error line 1']);

    // Verbose JSON output: fullOutput is present
    const verboseJson = JSON.parse(renderJson(sampleReport, true)) as Report;
    assert.deepEqual(Object.keys(verboseJson.versions[0].checks.aot).sort(), EXPECTED_CHECK_KEYS_VERBOSE);
    assert.equal(verboseJson.versions[0].checks.aot.fullOutput, 'full output');
    assert.deepEqual(verboseJson.versions[0].checks.aot.errorLines, ['error line 1']);
  });
});

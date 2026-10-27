# angular-compat-matrix

Which Angular versions does your published library really work with?

Run it with `npx angular-compat-matrix`, or install the package and run `angular-compat-matrix`.

angular-compat-matrix builds and packs your Angular library, installs the tarball into a fresh app for each Angular major (created with that major's own CLI), builds it, and reports a compatibility matrix. It tests the exact package your users get, not your local source.

```
$ npx angular-compat-matrix

my-dropdown@3.0.0 (compiled with Angular 21.2.0; highest minVersion 20.0.0)

            peer range  install  partial  AOT build  strict types
Angular 19      ✓          ✓        ✗         —           —
Angular 20      ✓          ✓        ✓         ✓           ✗
Angular 21      ✓          ✓        ✓         ✓           ✓
Angular 22      ✗          ✓        ✓         ✓           ✓

✗ 19: partial: Needs Angular 20.0.0 or later: highest minVersion 20.0.0, in
  MyDropdownComponent. Build the library with the oldest Angular you support, or take
  this version out of the peer range.
✗ 20: strict types: Fails with strictTemplates: true and skipLibCheck: false.
! 22: works, but peerDependencies doesn't allow it (@angular/core "^19.0.0 || ^20.0.0 ||
  ^21.0.0"). Widen the range to include it.
```

---

## Quick Start

Run it in your library's workspace: an Angular CLI workspace with a library project, or any folder with `ng-package.json`.

```sh
# Check supported majors plus every major your peer range claims
npx angular-compat-matrix

# Check a specific range or list of majors
npx angular-compat-matrix --versions 18-22
npx angular-compat-matrix --versions 20,22

# Check one library in a workspace with several
npx angular-compat-matrix --project my-lib

# Check a published package from npm (no local build needed)
npx angular-compat-matrix --package primeng@19.0.0

# Generate Markdown for your README or GitHub Actions summary
npx angular-compat-matrix --format markdown

# Machine-readable JSON output for CI pipelines
npx angular-compat-matrix --json

# Verbose output (shows exact commands executed and full failure logs)
npx angular-compat-matrix --verbose
```

---

## How to Read the Matrix

The matrix tests each Angular major in order. A failure on any step marks subsequent checks `—`, ensuring the first true incompatibility is reported clearly.

### Symbols

| Terminal | Markdown | Meaning |
| :---: | :---: | :--- |
| `✓` | `✅` | **Passed:** The check succeeded. |
| `✗` | `❌` | **Failed:** The check failed. |
| `✓?` | `✅*` | **Advisory pass:** Passed on `minVersion` alone, but because the library was compiled with a newer Angular major, `minVersion` has been historically unreliable. The build check decides compatibility. |
| `—` | `—` | **Not run:** Skipped because an earlier check failed. |
| `·` | `n/a` | **None:** Nothing to check (e.g. no `@angular/*` peer declared). |
| `!` | `⚠️` | **Setup error:** angular-compat-matrix itself could not set up the app on this machine (e.g. disk full, network timeout). This is not a library failure. |

---

## What It Checks

| Check | What it asks | How it verifies |
| --- | --- | --- |
| **Peer range** | Does your package claim this version? | Compares every declared `@angular/*` peer (e.g. `@angular/core`, `@angular/cdk`, `@angular/material`). Never stops other checks. |
| **Install** | Does it install cleanly without peer conflicts? | Installs the packed tarball into a fresh Angular app using your package manager (`npm` with `--legacy-peer-deps` + `npm ls`, or `pnpm` with `strictPeerDependencies: false`). For versions outside your peer range, expected peer conflicts are safely ignored. |
| **Partial** | Can this version's Angular linker load the compiled code? | Scans every `ɵɵngDeclare…` call in the published code for `minVersion`. A failure is absolute proof of incompatibility. |
| **AOT build** | Does a production app build with your library? | Runs `ng build --configuration production` (`strictTemplates: false`, `skipLibCheck: true`) on a smoke app using every public component, directive, pipe, service, and entry point. |
| **Strict types** | Do consumer templates type-check under strict settings? | Re-runs the build with `strictTemplates: true` and `skipLibCheck: false`. Catches template type errors and invalid typings. (Errors strictly inside third-party `node_modules/**/*.d.ts` are reported as warnings and do not fail the check). |
| **Tests** | Do your own unit tests pass on this version? | (Opt-in with `--tests`): Copies your workspace, swaps Angular dependencies to the target major, and executes your test command (`npm test` or `--test-command`). |

### The Generated Smoke App

When not using `--consumer`, angular-compat-matrix inspects your package typings and generates a standalone smoke app:
- Imports all entry points exposed in your `package.json` `exports` map.
- Instantiates each component, directive, and pipe in its own isolated component.
- Supplies correctly-typed mock values for required `@Input()` fields.
- Uses attribute selectors bare (`<div myFlag>`) when they accept booleans or strings, matching real user patterns.
- Handles undeclared dependencies in secondary entry points: if a secondary entry point (e.g. `my-lib/chart`) fails because an undeclared extra (like `chart.js`) is missing, angular-compat-matrix omits that entry point and warns you rather than failing the whole library. If the package's *main* entry point (`.`) imports an undeclared package, AOT fails immediately with a clear explanation.

If your library requires specialized providers, wrappers, or mock services, supply your own example app with `--consumer ./path-to-app`.

---

## Install-Script Safety Default & `--allow-scripts`

By default, angular-compat-matrix **blocks arbitrary install scripts** (`preinstall`, `install`, `postinstall`) during `npm` and `pnpm` installations.

Only native build tools essential to the Angular toolchain are permitted to run:
- `esbuild`
- `@parcel/watcher`
- `lmdb`
- `@swc/core`

If your library or one of its dependencies requires an install script to compile native bindings, opt in explicitly:
```sh
npx angular-compat-matrix --allow-scripts
```

If an installation or build fails while scripts were blocked, angular-compat-matrix explicitly lists which packages were skipped in the output findings so you know whether `--allow-scripts` is needed.

---

## Cache Management

angular-compat-matrix caches npm registry metadata and downloaded tools (such as pinned pnpm binaries) to keep runs fast and enable `--offline` usage.

```sh
# View cache location, disk usage, and file count
npx angular-compat-matrix cache

# Clear the cache entirely
npx angular-compat-matrix cache clean
```

### Cache Locations by OS

- **Linux:** `$XDG_CACHE_HOME/angular-compat-matrix` or `~/.cache/angular-compat-matrix`
- **macOS:** `~/.cache/angular-compat-matrix` (or `$XDG_CACHE_HOME/angular-compat-matrix`)
- **Windows:** `%LOCALAPPDATA%\angular-compat-matrix\Cache`
- **Custom Location:** Set the `ANGULAR_COMPAT_MATRIX_CACHE` environment variable to override the default on any OS.

---

## Exit Codes

angular-compat-matrix returns standard POSIX exit codes suitable for CI pipelines:

- **`0` (Success):** Every version claimed by the library's peer dependencies passed all checks. (If the library declares no `@angular/*` peer dependencies, 0 is returned if any checked version passes).
- **`1` (Broken Promise):** At least one Angular major claimed by your `peerDependencies` failed a check (install, partial, AOT, strict types, or tests).
- **`2` (Environment / Setup Error):** angular-compat-matrix could not check a version due to machine or network failure (e.g. disk full ENOSPC, network down, step timeout, invalid CLI options).

---

## In CI

### GitHub Actions

Write a workflow for your repository, from its root:

```sh
npx angular-compat-matrix ci github
```

It writes `.github/workflows/angular-compat-matrix.yml` with three jobs:

- **plan** works out the Angular majors when the workflow runs, the same way a local run does (supported majors, every major your peer range claims, and the newest). A new Angular major is picked up without editing the workflow.
- **check** runs one job per major, in parallel, each on the newest Node that major's `engines` allow.
- **summary** joins the results into one table in the run's summary.

It runs on pushes to `main`, on pull requests, and weekly, so a new Angular release that breaks your library shows up before your users notice. A version your peer range claims that fails turns the run red.

`ci github` takes the options that choose what to check (`--versions`, `--next`, `--project`, `--pm`, `--consumer`, `--build`, `--tests`, `--test-command`, `--allow-scripts`, `--step-timeout`, `--cwd`) and writes them into the workflow, plus:

- `--install <cmd>`: how the jobs install your workspace. Default: `npm ci`, or pnpm when there's a `pnpm-lock.yaml`.
- `--command <cmd>`: how the jobs run angular-compat-matrix. Default: `npx --yes angular-compat-matrix@<the version that wrote it>`, so upgrading is a matter of running `ci github --force` again.
- `--force`: overwrite an existing workflow.

For a single job instead, write the Markdown table to the summary yourself:

```yaml
      - run: npx angular-compat-matrix --format markdown >> "$GITHUB_STEP_SUMMARY"
```

---

## JSON Output & Stable Schema Contract

When running with `--json` or `--format json`, angular-compat-matrix outputs structured JSON with a fixed schema contract.

The top-level field `schemaVersion` is guaranteed. Any future additions or modifications to the JSON shape will increment `schemaVersion`.

### Schema Version 1 Specification

```json
{
  "schemaVersion": 1,
  "tool": {
    "name": "angular-compat-matrix",
    "version": "0.1.0"
  },
  "checkedAt": "2026-10-26T12:00:00.000Z",
  "library": {
    "name": "my-lib",
    "version": "1.0.0",
    "source": "package",
    "compiledWith": "20.2.0",
    "highestMinVersion": "20.0.0",
    "highestMinVersionIn": "component (dist/my-lib.mjs)",
    "declarations": 12
  },
  "packageManager": "npm",
  "installScripts": "toolchain-only",
  "node": "v24.19.0",
  "versions": [
    {
      "major": 21,
      "angularVersion": "21.2.0",
      "supported": true,
      "prerelease": false,
      "claimed": true,
      "peerMisses": [],
      "checks": {
        "peer": {
          "status": "pass",
          "message": "Claimed: @angular/core@^21.0.0.",
          "errorLines": [],
          "durationMs": 0
        },
        "install": {
          "status": "pass",
          "message": "Installed with npm.",
          "errorLines": [],
          "durationMs": 4200
        },
        "partial": {
          "status": "pass",
          "advisory": false,
          "message": "minVersion is 20.0.0.",
          "errorLines": [],
          "durationMs": 12
        },
        "aot": {
          "status": "pass",
          "message": "Production build succeeded.",
          "errorLines": [],
          "durationMs": 6100
        },
        "strict": {
          "status": "pass",
          "message": "Builds with strictTemplates: true and skipLibCheck: false.",
          "errorLines": [],
          "durationMs": 5900
        },
        "tests": {
          "status": "off",
          "message": "Not requested (--tests).",
          "errorLines": [],
          "durationMs": 0
        }
      },
      "skippedInstallScripts": [],
      "omittedEntryPoints": [],
      "dtsErrors": false,
      "durationMs": 16212
    }
  ],
  "findings": [
    {
      "level": "error",
      "majors": [19],
      "text": "AOT build: Production build failed."
    }
  ],
  "exitCode": 0
}
```

### JSON Fields Reference

- **`schemaVersion`** (`number`): The JSON schema version (currently `1`).
- **`tool`** (`{ name: string, version: string }`): CLI name and version.
- **`checkedAt`** (`string`): ISO-8601 timestamp when the check was performed.
- **`library`** (`object`):
  - `name`: Package name.
  - `version`: Package version.
  - `source`: How the package was acquired (`workspace`, `tarball`, or `package`).
  - `compiledWith` (`string?`): The Angular version that built this library.
  - `highestMinVersion` (`string?`): Highest `minVersion` found across declarations.
  - `highestMinVersionIn` (`string?`): Component or declaration file with the highest `minVersion`.
  - `declarations` (`number`): Count of Angular declarables detected.
- **`packageManager`** (`string`): `'npm'` or `'pnpm'`.
- **`installScripts`** (`'toolchain-only' | 'all'`): Whether `--allow-scripts` was active.
- **`node`** (`string`): Node.js runtime version.
- **`versions`** (`VersionReport[]`): Results per Angular major:
  - `major`: Angular major version number.
  - `angularVersion`: Resolved patch version checked.
  - `supported`: Whether this major is currently within Angular's official 18-month support window.
  - `prerelease`: Whether this major came from a pre-release tag (`next`).
  - `claimed`: `true` if peer dependencies include this version, `false` if excluded, `null` if no Angular peers declared.
  - `peerMisses`: Array of declared peers whose ranges excluded this major (`{ name, range, version }`).
  - `checks`: Object mapping check names (`peer`, `install`, `partial`, `aot`, `strict`, `tests`) to check results:
    - `status`: `'pass' | 'fail' | 'not-run' | 'off' | 'none'`.
    - `message`: Summary message.
    - `errorLines`: First relevant error lines extracted from build or install logs.
    - `fullOutput` (`string?`): Full command stdout and stderr on failure (optional; present only when `--verbose` is used).
    - `hint` (`string?`): Plain-language diagnostic hint.
    - `durationMs`: Execution duration in milliseconds.
    - `advisory` (`boolean?`): `true` when partial check passed only on `minVersion` despite being built with newer Angular.
  - `setupError` (`string?`): Description if the run failed due to machine/environment reasons.
  - `skippedInstallScripts` (`string[]?`): Packages whose install scripts were blocked.
  - `omittedEntryPoints` (`{ entry: string, missingPackage: string }[]?`): Secondary entry points skipped due to undeclared dependencies.
  - `dtsErrors` (`boolean?`): `true` if strict build had errors confined to `node_modules/**/*.d.ts`.
  - `durationMs`: Total duration for checking this major.
- **`findings`** (`Finding[]`): Merged diagnostics across all checked versions:
  - `level`: `'error' | 'warning' | 'note'`.
  - `majors`: Array of major version numbers affected.
  - `text`: Human-readable problem description and suggested resolution.
  - `suggestedPeerDependencies` (`Record<string, string>?`): Recommended peer dependencies when none were declared.
- **`exitCode`** (`number`): `0`, `1`, or `2`.

---

## Troubleshooting Real-World Issues

Here are the most common real-world incompatibilities identified across popular Angular packages and how to solve them:

### 1. Linker Crash on Older Angular (`Unsupported enum value` / `ɵɵFactoryTarget.Service`)
- **Symptom:** The library claims support for Angular 20 and 21, but on Angular 20 the linker crashes with `Unsupported enum value` or `Cannot create property 'message' on string`.
- **Cause:** The library was compiled with Angular 21 or 22. Newer Angular compilers emit bytecode constructs that older linkers do not recognize, even though `minVersion` was claimed as `12.0.0`.
- **Fix:** Compile your library with the **oldest** Angular major you support, or narrow your `peerDependencies` range to exclude older majors.

### 2. Secondary Entry Points with Undeclared Dependencies
- **Symptom:** A component in a secondary entry point (e.g. `primeng/chart` or `ng-zorro-antd/graph`) fails because `chart.js` or `dagre-d3-es` is not found.
- **Handling:** angular-compat-matrix omits secondary entry points that fail exclusively because of undeclared packages and flags a warning finding. However, if your **main** entry point (`.`) imports an undeclared package, angular-compat-matrix fails the AOT check because all consumers would experience build failures.
- **Fix:** Move undeclared packages into `peerDependencies` (or `dependencies` if required).

### 3. Library Typings Errors under `skipLibCheck: false`
- **Symptom:** Strict build fails with errors inside declaration files under `node_modules/**/*.d.ts`.
- **Handling:** When errors are confined strictly to third-party declaration files, angular-compat-matrix marks the strict check as passed with an informational warning finding (`"library typings have errors with skipLibCheck: false"`). It does not fail the version or trigger an exit code 1.
- **Fix:** Keep your third-party typing dependencies aligned with target TypeScript versions.

### 4. Disk Full (ENOSPC)
- **Symptom:** Exit code 2 with `ENOSPC: no space left on device`.
- **Fix:** Clear temporary build folders and caches using `npx angular-compat-matrix cache clean`, or point `ANGULAR_COMPAT_MATRIX_CACHE` and `TMPDIR`/`TEMP` to a drive with sufficient disk space.

> **Tip for library authors:** If your library accepts bare attributes like `<comp myFlag>`, give boolean inputs `@Input({ transform: booleanAttribute })` so consumers can write bare attributes under strict template checking (angular-compat-matrix does not check this).

---

## Options Reference

```
Usage
  npx angular-compat-matrix [options]
  npx angular-compat-matrix cache        (show cache location and size)
  npx angular-compat-matrix cache clean  (delete the cache)
  npx angular-compat-matrix ci github    (write a GitHub Actions workflow that runs the matrix)

Options
  --versions <list>      Angular majors to check: 22, 18-22, 20,22. Default: supported
                         majors, claimed majors (from 17), and the newest
  --next                 Also check whatever the `next` tag points to
  --project <name>       The library project, in a workspace with several
  --consumer <dir>       Build your own example app instead of a generated smoke app
  --tests                Also run the library's tests on each version (slow)
  --test-command <cmd>   The test command for --tests (default: <pm> test)
  --format <format>      terminal (default), markdown or json
  --json                 Shorthand for --format json
  --pm <npm|pnpm>        Package manager for the apps (default: pnpm if lockfile present, else npm)
  --build <cmd>          Build the library with this command instead of the detected one
  --skip-build           Pack the existing build output as is
  --tarball <file>       Check this packed .tgz instead of building
  --package <spec>       Check a published package, e.g. some-lib@3.1.0
  --concurrency <n>      Versions checked at once (default: based on available memory)
  --step-timeout <min>   Maximum minutes any single step may take (default: 20)
  --keep                 Keep the temporary apps after completion for debugging
  --allow-scripts        Permit all package install scripts to run (default: toolchain only)
  --offline              Use only cached registry answers and packages
  --cwd <dir>            The library's workspace (default: current directory)
  --verbose              Show commands run and full build/install output for failures
  -h, --help             Show help
  -v, --version          Show version
```

---

## Known Limitations & Roadmap

- **Supported Workspaces:** Angular CLI workspaces and standalone `ng-packagr` libraries.
- **Node.js:** Node 24.15 or later is recommended to cover all Angular majors from 17 through 22.
- **Planned:**
  - First-class Nx workspace discovery and integration.
  - Dedicated SSR (Server-Side Rendering) and `with-zone.js` validation columns.
- **Out of Scope:** Yarn and Bun (npm and pnpm cover package testing; JSON output makes custom wrappers simple), app migration tooling, and runtime browser testing.

---

## Development

```sh
npm install
npm test                       # run all unit tests
npm run build                  # compile TypeScript
npm ci --prefix fixtures       # install Angular fixture toolchain
node test/fixtures/run.ts      # run fixture integration tests

# After changing src/ci.ts, regenerate this repo's own workflow (it checks the healthy fixture):
node dist/cli.js ci github --force --cwd fixtures/libs/healthy --pm npm --command "node dist/cli.js" --install "npm ci && npm ci --prefix fixtures && npm run build"
```

---

## License

MIT © 2026 Nizamudeen S

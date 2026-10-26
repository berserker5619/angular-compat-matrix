# ng-matrix

Which Angular versions does your published library really work with?

ng-matrix builds and packs your Angular library, installs the tarball the way a user would into a fresh app for each Angular major (made with that major's own CLI), builds it, and reports a matrix. It tests the package your users get, not the source you see.

```
$ npx ng-matrix

my-dropdown@3.0.0 (compiled with Angular 21.2.0; highest minVersion 20.0.0)

            peer range  install  partial  AOT build  strict types
Angular 19      ✓          ✓        ✗         —           —
Angular 20      ✓          ✓        ✓         ✓           ✗
Angular 21      ✓          ✓        ✓         ✓           ✓
Angular 22      ✗          ✓        ✓         ✓           ✓

✗ 19: partial: Needs Angular 20.0.0 or later: highest minVersion 20.0.0, in
  MyDropdownComponent. Build the library with the oldest Angular you support, or take
  this version out of the peer range.
✗ 20: strict types: A template using the package type-checks only loosely…
! 22: works, but peerDependencies doesn't allow it (@angular/core "^19.0.0 || ^20.0.0 ||
  ^21.0.0"). Widen the range to include it.
```

## Usage

Run it in your library's workspace: an Angular CLI workspace with a library project, or a folder with `ng-package.json`.

```sh
npx ng-matrix                        # supported majors plus every major your peer range claims
npx ng-matrix --versions 18-22       # an explicit range (or 22, or 20,22)
npx ng-matrix --project my-lib       # one library in a workspace with several
npx ng-matrix --consumer ./example   # build your own example app instead of a generated one
npx ng-matrix --tests                # also run your library's tests on each version
npx ng-matrix --pm pnpm              # npm (default) or pnpm
npx ng-matrix --format markdown      # a table for your README; also json
npx ng-matrix --package some-lib@3   # check a published package instead of building
```

`npx ng-matrix --help` lists every option.

**Exit code:** 1 when a version inside your peer range fails, so CI goes red only for broken promises. A version outside the range that fails is a note. 2 means ng-matrix couldn't check a version at all.

**Node:** ng-matrix runs every Angular version on the Node it runs on, and stops early if that Node is too old for one of them. Node 24.15 or later covers Angular 17 to 22. Angular's `engines` ranges only set minimums; [Angular's own support table](https://angular.dev/reference/versions) is narrower.

## What it checks

For each Angular major, in order. A failure marks the later checks `—`, so the first real failure is the one reported. The peer range is reported but never stops the other checks.

| Check | Question | How |
| --- | --- | --- |
| Peer range | Does the package claim this version? | Every `@angular/*` peer is compared, not just `core`: a CDK range can leave a version out too |
| Install | Does it install in a fresh app without peer conflicts? | npm: `--legacy-peer-deps` with the peers added explicitly, then `npm ls` reports every invalid peer. pnpm: `strict-peer-dependencies`. For a version the range doesn't claim, only that expected conflict is ignored |
| Partial | Can this version's linker load the compiled code? | The highest `minVersion` in the package's `ɵɵngDeclare…` calls. ✗ is proof; ✓ is only advisory (`✓?`) when the package was compiled with a newer major, because `minVersion` has been too low before |
| AOT build | Does a production build of an app using it succeed? | `ng build` of a smoke app that uses every public export, with `strictTemplates: false` and no size budgets |
| Strict types | Do templates using it type-check? | The same build with `strictTemplates: true` and `skipLibCheck: false`, which also catches typings that use types an older `@angular/core` lacks |
| Tests | Do your own tests pass on this version? | With `--tests`: your test command in a copy of your workspace, with Angular swapped to this version |

### Why build, when there's minVersion?

The Angular compiler writes a `minVersion` into each compiled declaration: the oldest Angular whose linker can handle the features it uses. It's set per feature, not from the Angular that compiled the code, and it has been too low more than once. Angular 16.1's input transforms broke 16.0 apps ([angular/angular#51413](https://github.com/angular/angular/pull/51413)). In Angular 22, factory declarations claim `minVersion: "12.0.0"` while using `ɵɵFactoryTarget.Service`, which only 22 has; an Angular 21 linker crashes on them with `Unsupported enum value`. So `minVersion` can prove a version fails, never that it works.

### The smoke app

ng-matrix reads your package's typings, where Angular records each declaration's selector, inputs and standalone flag. It writes one component that:

- imports every entry point in your `exports` map
- uses each component, directive and pipe once, with a correctly typed value for every required input
- writes attribute selectors that take a boolean or string bare (`<div myFlag>`), the way users do
- imports your NgModules and uses what they export, and injects your services

If your library needs more setup than that (providers, content, a parent component), give ng-matrix an example app with `--consumer`. It's copied, its Angular dependencies are moved to each version, and your package is installed from the tarball.

## In CI

A GitHub Actions job that checks the supported majors on every push:

```yaml
jobs:
  angular-matrix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npx ng-matrix --format markdown >> "$GITHUB_STEP_SUMMARY"
```

(`ng-matrix ci github`, which writes a workflow with one job per Angular version, is coming in v0.2.)

## Where version data comes from

Nothing about Angular's versions is hard-coded. It all comes from the npm registry when ng-matrix runs, and is cached for a day (`--offline` reuses the cache):

- **Majors:** the published `@angular/core` versions, latest patch of each. A major counts as supported for 18 months after its x.0.0 release. `--next` adds whatever the `next` tag points to, which may be a minor pre-release.
- **Node:** the `engines` of that version's `@angular/core` and `@angular/cli`.
- **TypeScript** (for `--tests`): `@angular/compiler-cli`'s peer range. **RxJS and zone.js:** `@angular/core`'s.
- **Your other peers** (Material, CDK…): the newest version whose own peer ranges accept that Angular.

## Scope of v0.1

In: Angular CLI workspaces and standalone ng-packagr libraries; npm 11 and a pinned pnpm (12.15.0); the six checks; terminal, Markdown and JSON output.

Coming in v0.2: Nx workspaces (for now, run ng-matrix in the library folder with `--build "npx nx build my-lib"`), `ng-matrix ci github`, and SSR and with-zone.js columns.

Not planned: Yarn and Bun (the JSON output makes them easy to add), checking apps for upgrade readiness, and anything that only shows up at runtime in a browser.

## Development

```sh
npm install
npm test                       # unit tests, against recorded registry answers
npm run build
npm ci --prefix fixtures       # the Angular 22 toolchain the fixture libraries build with
node test/fixtures/run.ts      # every fixture case (or name one, e.g. healthy-npm)
```

`fixtures/libs` holds small libraries that each fail exactly one check: a feature newer than an older claimed major, a `minVersion` that's too low, peer ranges narrower and wider than reality, a CDK peer that leaves a version out, a type error only strict templates catch, typings only `skipLibCheck: false` catches, a kit over the default size budget, full compilation output, and tests that use a newer API. `fixtures/workspaces/cli-workspace` is an Angular CLI workspace, and `fixtures/consumers/healthy-example` an example app for `--consumer`. The suite also checks two published packages: Angular Material 22 and angular2-multiselect-dropdown 10.

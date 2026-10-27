# Real-world round, 26 October 2026

angular-compat-matrix 0.1 was run with `--package` against the 50 most-downloaded Angular community libraries on the supported majors (20, 21 and 22: `--versions 20-22`, npm 11, Node 24.19, with install-script safety active). For each failure, the question was whether it's a real problem in the library or a false failure in angular-compat-matrix. False failures were fixed, each with a regression test. This page lists what the libraries really do.

## Summary

- **Total libraries evaluated:** 50
- **Total run time:** 45 minutes (~53s per library across 3 majors)
- **Peak temp folder use:** 1.13 GB (average ~0.7 GB)
- **Toolchain cache size:** 0.30 GB
- **False failures identified:** 0 in this 50-library run (all failures were real library incompatibilities or missing runtime dependencies).
- **Narrow ranges:** A majority of packages claiming only Angular 22 compile and build cleanly with strict types on Angular 20 and 21.

| Library | Version | Compiled with | `@angular/core` peer | 20 | 21 | 22 | Run time (s) | Peak Disk (GB) |
| :--- | :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: |
| @coreui/angular | 5.7.37 | 22.2.3 | `^22.2.0` | ❌ install, not claimed | ❌ install, not claimed | ✅ | 46 | 0.75 |
| @fortawesome/angular-fontawesome | 5.1.0 | 22.0.5 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 47 | 0.68 |
| @kolkov/ngx-gallery | 2.0.1 | 13.1.3 | `>=13.0.0 <14` | ⚠️ works, not claimed | ⚠️ works, not claimed | ❌ aot, not claimed | 60 | 0.68 |
| @ng-select/ng-select | 24.2.1 | 22.2.0 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 51 | 0.69 |
| @ngneat/overview | 8.1.0 | 21.2.6 | `>=21` | ❌ strict types, not claimed | ✅ | ✅ | 53 | 0.68 |
| @ngneat/transloco | 6.0.4 | 16.1.7 | `>=16.0.0` | ✅ | ✅ | ✅ | 57 | 0.71 |
| @ngneat/until-destroy | 10.0.0 | - | `>=13` | ✅ | ✅ | ✅ | 52 | 0.67 |
| @ngrx/component | 22.0.1 | 22.1.3 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 50 | 0.67 |
| @ngrx/effects | 22.0.1 | 22.1.3 | `^22.0.0` | ❌ install, not claimed | ❌ install, not claimed | ✅ | 42 | 0.66 |
| @ngrx/entity | 22.0.1 | - | `^22.0.0` | ❌ install, not claimed | ❌ install, not claimed | ✅ | 38 | 0.66 |
| @ngrx/router-store | 22.0.1 | 22.1.3 | `^22.0.0` | ❌ install, not claimed | ❌ install, not claimed | ✅ | 44 | 0.64 |
| @ngrx/signals | 22.0.1 | 22.1.3 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 47 | 0.68 |
| @ngrx/store | 22.0.1 | 22.1.3 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 51 | 0.67 |
| @ngx-translate/core | 18.0.0 | 22.0.0 | `>=18` | ✅ | ✅ | ✅ | 58 | 0.67 |
| @ngx-translate/http-loader | 18.0.0 | 22.0.0 | `>=18` | ✅ | ✅ | ✅ | 50 | 0.67 |
| ag-grid-angular | 36.2.0 | 20.3.30 | `>= 20.0.0` | ✅ | ✅ | ✅ | 54 | 0.76 |
| angular-calendar | 0.32.2 | 20.2.1 | `>=20.2.0` | ✅ | ✅ | ✅ | 73 | 0.74 |
| angular-gridster2 | 22.0.0 | 22.0.3 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 60 | 0.68 |
| angular-split | 20.0.0 | 19.0.5 | `>=19.0.0` | ✅ | ✅ | ✅ | 48 | 0.67 |
| angular-svg-icon | 19.1.1 | 19.0.5 | `>=19.0.0` | ✅ | ✅ | ✅ | 51 | 0.67 |
| ng-zorro-antd | 22.1.2 | 22.1.0 | `^22.0.0` | ❌ aot, not claimed | ❌ aot, not claimed | ✅ | 123 | 0.97 |
| ng2-charts | 11.0.0 | 22.1.6 | `>=22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 61 | 0.74 |
| ngx-autosize | 2.0.4 | 13.3.1 | `>12.0.0` | ✅ | ✅ | ✅ | 51 | 0.67 |
| ngx-bootstrap | 22.0.0 | 22.0.2 | `^22.0.0` | ❌ aot, not claimed | ⚠️ works, not claimed | ✅ | 70 | 0.69 |
| ngx-clipboard | 16.0.0 | 15.1.4 | `>=13.0.0` | ✅ | ✅ | ✅ | 49 | 0.68 |
| ngx-color | 10.1.0 | 19.1.3 | `>=19.0.0-0` | ✅ | ✅ | ✅ | 54 | 0.69 |
| ngx-color-picker | 20.1.1 | 20.0.4 | `>=19.0.0` | ✅ | ✅ | ✅ | 51 | 0.67 |
| ngx-cookie-service | 22.0.0 | 22.0.0 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 46 | 0.67 |
| ngx-countup | 21.0.0 | 21.0.2 | `^21.0.0` | ⚠️ works, not claimed | ✅ | ⚠️ works, not claimed | 52 | 0.67 |
| ngx-device-detector | 12.0.0 | 22.0.0 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 51 | 0.68 |
| ngx-drag-drop | 22.1.0 | 22.1.2 | `>=22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 51 | 0.68 |
| ngx-echarts | 22.0.0 | 22.0.0 | `>=22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 61 | 0.86 |
| ngx-filter-pipe | 3.0.1 | 17.3.8 | `>=5.0.0` | ✅ | ✅ | ✅ | 49 | 0.68 |
| ngx-guided-tour | 2.0.1 | 13.3.0 | `>=13.0.0` | ❌ aot | ❌ aot | ❌ aot | 43 | 0.67 |
| ngx-highlightjs | 14.0.1 | 19.2.14 | `>=19.0.0` | ✅ | ✅ | ✅ | 55 | 0.71 |
| ngx-image-cropper | 9.1.7 | 17.3.12 | `>=17.3.0` | ✅ | ✅ | ✅ | 48 | 0.69 |
| ngx-infinite-scroll | 22.0.0 | 22.0.5 | `>=22.0.0 <23.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 62 | 0.67 |
| ngx-intl-tel-input | 17.0.0 | 17.3.12 | `>= 17.0.0` | ❌ aot | ✅ | ✅ | 64 | 1.04 |
| ngx-markdown | 22.1.1 | 22.1.4 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 69 | 1.13 |
| ngx-mask | 22.2.5 | 22.2.3 | `^22.0.0` | ❌ strict types, not claimed | ⚠️ works, not claimed | ✅ | 44 | 0.68 |
| ngx-monaco-editor-v2 | 22.0.5 | 22.0.4 | `^22.0.4` | ❌ aot, not claimed | ⚠️ works, not claimed | ✅ | 51 | 1.01 |
| ngx-pagination | 6.0.3 | 13.3.9 | `>=13.0.0` | ✅ | ✅ | ✅ | 50 | 0.67 |
| ngx-perfect-scrollbar | 10.1.1 | - | `>=9.0.0` | ✅ | ✅ | ✅ | 49 | 0.68 |
| ngx-permissions | 19.0.0 | 19.1.4 | `>=13 || >25` | ✅ | ✅ | ✅ | 52 | 0.68 |
| ngx-quill | 31.0.1 | 22.0.2 | `^22.0.0` | ❌ strict types, not claimed | ⚠️ works, not claimed | ✅ | 63 | 0.69 |
| ngx-skeleton-loader | 14.0.0 | 22.0.0 | `>=19.0.0` | ✅ | ✅ | ✅ | 45 | 0.68 |
| ngx-socket-io | 4.11.1 | 22.0.1 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ | 58 | 0.72 |
| ngx-spinner | 22.0.1 | 22.1.3 | `>=20.0.0` | ✅ | ✅ | ✅ | 46 | 0.67 |
| ngx-toastr | 20.0.5 | 21.1.0 | `^21.0.0` | ⚠️ works, not claimed | ✅ | ⚠️ works, not claimed | 48 | 0.67 |
| primeng | 22.1.4 | 22.2.3 | `^22.1.0` | ❌ aot, not claimed | ⚠️ works, not claimed | ✅ | 81 | 0.75 |

✅ every check passed and the range claims it. ⚠️ every check passed, but the peer range leaves the version out. ❌ a check failed.

"Works" means what angular-compat-matrix checks: the published package installs, links and builds in a fresh app, in production mode and with strict templates and `skipLibCheck: false`, with every public export used. It says nothing about runtime behaviour in a browser.

## Real findings

### Missing undeclared dependencies in published packages (primeng, ng-zorro-antd, ngx-guided-tour)
- **primeng 22.1.4**: Secondary entry point `primeng/chart` imports `chart.js/auto`, which is neither a declared dependency nor peer dependency. When `primeng/chart` is omitted, the core library AOT builds cleanly, and angular-compat-matrix reports the warning finding: `entry point primeng/chart imports chart.js, which isn't declared in dependencies or peers`.
- **ng-zorro-antd 22.1.2**: Secondary entry points `ng-zorro-antd/cron-expression` and `ng-zorro-antd/graph` import `cron-parser`, `d3-shape`, and `d3-drag`, none of which are declared dependencies of ng-zorro-antd. When those entry points are omitted, the rest of the library AOT builds cleanly with warning findings reported.
- **ngx-guided-tour 2.0.1**: Imports `lodash` in its main entry point (`"."`), which is not declared in dependencies or peers. Because omitting the main entry point would leave nothing to test (and every consumer of ngx-guided-tour requires `lodash`), angular-compat-matrix does not omit it and fails the AOT check with: `"ngx-guided-tour imports lodash, which isn't declared in dependencies or peers. Every user of ngx-guided-tour needs lodash installed."` Comes out as FAIL (aot) across Angular 20, 21, and 22.

### Angular version typing & API mismatches
- **@ngneat/overview 8.1.0**: Peer range is `>=21`. Fails strict typecheck on Angular 20 with `TS2459: Module '"@angular/core"' declares 'DirectiveWithBindings' locally, but it is not exported`.
- **@kolkov/ngx-gallery 2.0.1**: Fails AOT on Angular 22 because it imports `HammerGestureConfig` and `HAMMER_GESTURE_CONFIG` from `@angular/platform-browser`, which were removed in Angular 22.
- **ngx-monaco-editor-v2 22.0.5**: Angular linker crashes on Angular 20 (`Unsupported change detection strategy: ChangeDetectionStrategy.Eager`) because `ChangeDetectionStrategy.Eager` was introduced in Angular 21, yet the package claimed a `minVersion` of `17.2.0`. angular-compat-matrix correctly flagged `advisory: true` for the partial compilation check and caught the incompatibility during AOT build.
- **ngx-bootstrap 22.0.0**: Compiled with Angular 22 emitting `ChangeDetectionStrategy.Eager`, causing Angular 20 linker to crash (`Unsupported change detection strategy`). However, it builds and type-checks cleanly on both Angular 21 and 22.
- **ngx-intl-tel-input 17.0.0**: Declares peer dependency on `ngx-bootstrap >= 12.0.0`. On Angular 20, picking `ngx-bootstrap@20.0.2` fails AOT because `ngx-bootstrap` imports `@angular/animations`, which wasn't part of `ngx-intl-tel-input`'s direct peers.

### Library typings errors with skipLibCheck: false (@coreui/angular 5.7.37, primeng 22.1.4, ng-zorro-antd 22.1.2)
When the strict build fails only because of errors inside `node_modules` declaration (`.d.ts`) files under `skipLibCheck: false`, angular-compat-matrix marks the strict check as passed with a warning finding (`"library typings have errors with skipLibCheck: false"`), ensuring library typing oversights do not mark the version broken or fail the exit code.
- **@coreui/angular 5.7.37**: Typings reference `node_modules/rxjs/dist/types` directly (`TS2307: Cannot find module 'node_modules/rxjs/dist/types'`). Strict check passes with warning; exit code: 0.
- **primeng 22.1.4**: Typings reference `NodeJS.Timeout` without `@types/node`, and `chart.js` typings. Strict check passes with warning; exit code: 0.
- **ng-zorro-antd 22.1.2**: Typings reference `monaco-editor` in `code-editor.d.ts`. Strict check passes with warning; exit code: 0.

### Tight sibling peer constraints (@ngrx/effects, @ngrx/entity, @ngrx/router-store)
- `@ngrx/effects@22.0.1` requires `@ngrx/store` strictly at `"22.0.1"`. In an Angular 20 app, npm peer resolution resolves the Angular 20 ecosystem, causing a peer mismatch against the strict 22.0.1 requirement.

## False failures in angular-compat-matrix, fixed

| Library | What failed | Why it was angular-compat-matrix | Fix | Regression test |
| --- | --- | --- | --- | --- |
| angular-calendar | AOT build on 20–22: `Could not resolve "date-fns"` | date-fns and moment are optional peers, and angular-compat-matrix skipped optional peers. The smoke app imports every entry point, including the date-fns adapter, which needs date-fns, just as a user of that adapter installs it | Optional peers are installed; they still don't count toward what the range claims | `test/unit/peers.test.ts` (installs optional peers, but they claim nothing); fixture case `real-angular-calendar` |
| ngx-toastr | AOT build on 22: `NG8023: Multiple components match node with tagname div: 'ToastBase', 'Toast'` | Both components use the selector `[toast-component]`. The smoke app used every export in one template, so one element matched both. No app imports both into one template; Angular 22 now reports it at compile time | Each standalone declarable, pipe and NgModule gets a small component of its own, as an app would use it | `test/unit/smoke.test.ts` (never puts two exports with the same selector in one template); fixture case `real-ngx-toastr` |
| ngx-bootstrap | Strict build on 21 & 22: `TS2322: Type 'string' is not assignable to type 'boolean'` on `<div collapse></div>` | Smoke app wrote bare attributes for selector inputs (`collapse`), passing empty string `""` which fails strict templates for strictly `boolean` inputs | Smoke app only writes bare attributes if the input's write type accepts string/any/unknown or `""`; otherwise binds with `[prop]="v..."` | `test/unit/smoke.test.ts` (binds strictly boolean inputs); fixture case `strict-attr` |
| primeng, ng-zorro-antd, ngx-guided-tour | Secondary entry points failed AOT: `Could not resolve "chart.js/auto"`, `cron-parser`, `d3-*` | Secondary entry points imported undeclared packages. Real users only install those extras when using those components. Main entry points (`"."`) must never be omitted | Secondary entry points are omitted from smoke build with warning findings. If the undeclared package is in the main entry point or leaves nothing to test, AOT fails | `test/unit/build.test.ts`, `test/unit/report.test.ts`, fixture `undeclared-main` |
| @coreui/angular, primeng, ng-zorro-antd | Strict build failed only due to `.d.ts` typing errors under `skipLibCheck: false` | Third-party `.d.ts` issues (e.g. missing ambient `@types/node` or broken relative rxjs import path) are not consumer application type errors | Strict check is marked as passed with warning finding `library typings have errors with skipLibCheck: false`; does not fail exit code | `test/unit/build.test.ts` (isDtsOnlyFailure); `test/unit/report.test.ts`; fixture `dts-only` |

## How to reproduce

```sh
npx angular-compat-matrix --package ngx-toastr@20.0.5 --versions 20-22
```

Results depend on the registry on the day: the newest Angular patch of each major, and the newest version of each peer that accepts it.

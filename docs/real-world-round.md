# Real-world round, 26 October 2026

ng-matrix 0.1 was run with `--package` against 15 popular Angular libraries on the supported majors (20, 21 and 22: `--versions 20-22`, npm 11, Node 24.19). For each failure, the question was whether it's a real problem in the library or a false failure in ng-matrix. False failures were fixed, each with a regression test. This page lists what the libraries really do.

## Summary

No library fails on a version its peer range claims. The most common real finding is the opposite: **peer ranges narrower than reality**. 10 of the 15 work on Angular versions they don't claim, so users on those versions get peer conflicts (npm fails with `ERESOLVE`) for a package that would work. Two libraries also ship typings that need Angular 21, which correctly keeps 20 out of their range.

| Library | Version | Compiled with | `@angular/core` peer | 20 | 21 | 22 |
| --- | --- | --- | --- | :-: | :-: | :-: |
| angular-calendar | 0.32.2 | 20.2.1 | `>=20.2.0` | ✅ | ✅ | ✅ |
| angular-gridster2 | 22.0.0 | 22.0.3 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ |
| @ng-select/ng-select | 24.2.1 | 22.2.0 | `^22.0.0` (and CDK, forms, common) | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ |
| ng2-charts | 11.0.0 | 22.1.6 | `>=22.0.0` (and CDK, common, platform-browser) | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ |
| @ngrx/store | 22.0.1 | 22.1.3 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ |
| ngx-color-picker | 20.1.1 | 20.0.4 | `>=19.0.0` | ✅ | ✅ | ✅ |
| ngx-cookie-service | 22.0.0 | 22.0.0 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ |
| ngx-image-cropper | 9.1.7 | 17.3.12 | `>=17.3.0` | ✅ | ✅ | ✅ |
| ngx-infinite-scroll | 22.0.0 | 22.0.5 | `>=22.0.0 <23.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ |
| ngx-markdown | 22.1.1 | 22.1.4 | `^22.0.0` | ⚠️ works, not claimed | ⚠️ works, not claimed | ✅ |
| ngx-mask | 22.2.5 | 22.2.3 | `^22.0.0` | ❌ strict types, not claimed | ⚠️ works, not claimed | ✅ |
| ngx-quill | 31.0.1 | 22.0.2 | `^22.0.0` | ❌ strict types, not claimed | ⚠️ works, not claimed | ✅ |
| ngx-skeleton-loader | 14.0.0 | 22.0.0 | `>=19.0.0` | ✅ | ✅ | ✅ |
| ngx-toastr | 20.0.5 | 21.1.0 | `^21.0.0` | ⚠️ works, not claimed | ✅ | ⚠️ works, not claimed |
| @ngx-translate/core | 18.0.0 | 22.0.0 | `>=18` | ✅ | ✅ | ✅ |

✅ every check passed and the range claims it. ⚠️ every check passed, but the peer range leaves the version out. ❌ a check failed.

"Works" means what ng-matrix checks: the published package installs, links and builds in a fresh app, in production mode and with strict templates and `skipLibCheck: false`, with every public export used. It says nothing about runtime behaviour in a browser.

## Real findings

### ngx-toastr 20.0.5: the latest release doesn't claim the latest Angular

Its peer range is `^21.0.0` for `@angular/core` and `@angular/common`, but it installs and builds on Angular 22 (and 20). Angular 22 is the current major, so this is the finding with the most practical effect: `npm install ngx-toastr` in a new Angular 22 app fails with `ERESOLVE` unless the user passes `--legacy-peer-deps`. Widening the range to `^20.0.0 || ^21.0.0 || ^22.0.0` would match what works.

### ngx-quill 31.0.1 and ngx-mask 22.2.5: typings that need Angular 21

Both build on Angular 20, but their typings import from `@angular/forms/signals`, which Angular 20 doesn't have:

```
X [ERROR] TS2307: Cannot find module '@angular/forms/signals' or its corresponding type declarations.
    node_modules/ngx-quill/types/ngx-quill.d.ts:6:51
    node_modules/ngx-mask/types/ngx-mask.d.ts:4:33
```

Apps with the default `skipLibCheck: true` don't see it, but any app that checks library typings, or uses the affected types, fails to compile. Neither library claims Angular 20, so their ranges are right to leave it out. Both work on Angular 21, which they don't claim either.

### Peer ranges narrower than reality

angular-gridster2, @ng-select/ng-select, ng2-charts, @ngrx/store, ngx-cookie-service, ngx-infinite-scroll and ngx-markdown claim only Angular 22, and all of them pass every check on 20 and 21. ngx-quill and ngx-mask also work on 21. For most of these, matching the library's major to Angular's is a deliberate policy (older majors of the library cover older Angular), so this isn't a bug. But it is a real cost to users on 20 or 21 who want a fix that's only in the latest release.

### Open-ended ranges

ngx-image-cropper (`>=17.3.0`), ngx-skeleton-loader (`>=19.0.0`), ngx-color-picker (`>=19.0.0`), angular-calendar (`>=20.2.0`), @ngx-translate/core (`>=18`) and ng2-charts (`>=22.0.0`) claim every future Angular major in advance. They all work on 22 today. That's a promise nobody has checked for 23. A scheduled ng-matrix run with `--next` is how to find out before users do.

### Compiled with an older Angular

ngx-image-cropper 9.1.7 is compiled with Angular 17.3 and ngx-color-picker 20.1.1 with 20.0, and both work on 22. That's the safe direction: partial compilation output from an older Angular is meant to work on newer ones. Every library compiled with 22 also linked on 20 and 21 (the ✓? in ng-matrix's Partial column), because none of them uses a 22-only declaration such as `@Service()`.

## False failures in ng-matrix, fixed

| Library | What failed | Why it was ng-matrix | Fix | Regression test |
| --- | --- | --- | --- | --- |
| angular-calendar | AOT build on 20–22: `Could not resolve "date-fns"` | date-fns and moment are optional peers, and ng-matrix skipped optional peers. The smoke app imports every entry point, including the date-fns adapter, which needs date-fns, just as a user of that adapter installs it | Optional peers are installed; they still don't count toward what the range claims | `test/unit/peers.test.ts` (installs optional peers, but they claim nothing); fixture case `real-angular-calendar` |
| ngx-toastr | AOT build on 22: `NG8023: Multiple components match node with tagname div: 'ToastBase', 'Toast'` | Both components use the selector `[toast-component]`. The smoke app used every export in one template, so one element matched both. No app imports both into one template; Angular 22 now reports it at compile time | Each standalone declarable, pipe and NgModule gets a small component of its own, as an app would use it | `test/unit/smoke.test.ts` (never puts two exports with the same selector in one template); fixture case `real-ngx-toastr` |

A third false failure turned up in the new pnpm fixture rather than a library: with `--tests --pm pnpm`, `pnpm test` ran in a shell where ng-matrix's own pnpm wasn't on PATH, so every version's tests "failed" with `'pnpm' is not recognized`. The test command now gets a `pnpm` shim first on PATH (`test/unit/tools.test.ts`, fixture case `tests-newer-api-pnpm`, which also checks why the tests failed, not just that they did).

## How to reproduce

```sh
npx angular-compat-matrix --package ngx-toastr@20.0.5 --versions 20-22
```

Results depend on the registry on the day: the newest Angular patch of each major, and the newest version of each peer that accepts it.

# Changelog

## 0.3.0 (2026-10-27)

### Breaking

- The `ng-matrix` command is removed; use `angular-compat-matrix` (or `npx angular-compat-matrix`).
- `NG_MATRIX_CACHE` is no longer read; use `ANGULAR_COMPAT_MATRIX_CACHE`.
- Old cache and temp folders named `ng-matrix…` are no longer used and can be deleted:
  - Cache, Linux and macOS: `$XDG_CACHE_HOME/ng-matrix`, or `~/.cache/ng-matrix`
  - Cache, Windows: `%LOCALAPPDATA%\ng-matrix`
  - Temp work folders `ng-matrix-XXXXXX` (only left behind by runs that were killed), Linux: `$TMPDIR` or `/tmp`; macOS: `$TMPDIR`; Windows: `%TEMP%`

### Added

- `angular-compat-matrix ci github` writes a GitHub Actions workflow: one job per Angular major (worked out when it runs, each on a Node that major supports), joined into one table in the run summary, on pushes, pull requests and weekly.

### Changed

- Help, messages, docs and the output prefix say `angular-compat-matrix` throughout.

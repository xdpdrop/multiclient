# Scripts (`scripts/`)

Build and test helpers: `native.cjs` (postinstall), `build-supervisor.cjs`, `build-artifact-renderer.cjs`, `test-*.cjs` integration runners, `ci-step.sh` (Linux CI display wrapper), `check.sh` (quiet agent gate).

`npm ci` runs `postinstall` → `native.cjs` (bundled `better-sqlite3` prebuild; on Linux rebuilds `node-pty` for Electron; fixes `spawn-helper` execute bits for macOS).

## CI wrapper

GitHub Actions (`.github/workflows/ci.yml`, job `verify`) runs on GitHub-hosted runners. Pull requests and pushes to `main` run `ubuntu-latest` only. `windows-latest` and `macos-latest` run only on `v*` tags and `workflow_dispatch`. Each step uses `bash scripts/ci-step.sh`. Linux starts Xvfb and Openbox; the Configure Electron sandbox step sets `chrome-sandbox` to root-owned mode `4755`. Steps are separate — not one `npm run check` invocation. Verify runs Lint (`npm run lint`) before Typecheck, then unit tests, build, integration scripts, smoke, and Playwright. Releases are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`); no in-repo code signing.

`node scripts/ci-run-check.mjs --repo <owner/name> --run <run-id> [--gate <file>] [--sha <hex>]` requires a successful run for the head SHA. It fails when that commit's subject contains `[skip ci]`. Earlier commits on the branch may still use the marker. `bash scripts/check.sh` also runs `node scripts/check-tests.mjs`.

## Desktop verification skill

`.cursor/skills/verify-multiclient/` — optional local send, theme, and history checks after `npm ci` and `npm run build` (and Linux sandbox bit). Does not replace `scripts/check.sh` or full `npm run check`.

## Packaging

`npm run pack` (unpacked dir), `npm run dist`, `npm run dist:win` (unsigned Windows x64 zip, `--publish never`). Output dirs: `out/` from electron-vite; Windows archive `release/Multiclient-win-x64.zip`. `electron-builder.yml` sets `publish: null`.

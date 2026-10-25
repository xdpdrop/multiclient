# AGENTS.md

Multiclient is a local-first Windows desktop client for AI conversations and project work — Electron, TypeScript, React, plus a small C# Windows supervisor. Use this file for the repo map and commands; folder-specific rules live in nested `AGENTS.md` files. Deeper narrative: [docs/architecture/README.md](docs/architecture/README.md), [docs/contributing/README.md](docs/contributing/README.md), [SECURITY.md](SECURITY.md).

## Agent rules

Agents push, open a ready (non-draft) PR or update the existing one, and end their turn. Do not poll or wait on CI; the reviewer checks CI.

- Work on a branch; never push to the default branch, never push tags, never merge.
- One purpose per PR, at most 400 changed lines.
- Run the local checks under Commands before pushing.
- State only verified facts in PR bodies; label anything unverified.

## Models

Grok only. Ladder, one try per rung before stepping up: `composer-2.5` (trivial) → `grok-4.7-medium` (default) → `grok-4.7-high` (hardest). If `grok-4.7-high` fails, report blocked. No third-party models (Claude, GPT, Gemini, etc.) without Marek's explicit approval for that specific task.

## Processes (entry points)

Hard trust split: the renderer cannot reach Node, Electron, or SQLite.

| Process  | Entry                                               | Notes                                            |
| -------- | --------------------------------------------------- | ------------------------------------------------ |
| Main     | `src/main/index.ts`                                 | [src/main/AGENTS.md](src/main/AGENTS.md)         |
| Preload  | `src/preload/index.ts`                              | [src/preload/AGENTS.md](src/preload/AGENTS.md)   |
| Renderer | `src/renderer/src/main.tsx`, `src/renderer/App.tsx` | [src/renderer/AGENTS.md](src/renderer/AGENTS.md) |
| Runtime  | `src/runtime/index.ts`                              | [src/runtime/AGENTS.md](src/runtime/AGENTS.md)   |
| Bridges  | `src/bridges/*/index.ts`                            | [src/bridges/AGENTS.md](src/bridges/AGENTS.md)   |

IPC contracts: [src/shared/AGENTS.md](src/shared/AGENTS.md). Build scripts: [scripts/AGENTS.md](scripts/AGENTS.md).

## File map

| Path                      | Contents                                                                 |
| ------------------------- | ------------------------------------------------------------------------ |
| `src/main`                | Electron main process                                                    |
| `src/preload`             | `window.desktop` preload API                                             |
| `src/renderer`            | Sandboxed React UI                                                       |
| `src/runtime`             | Utility process (SQLite, providers, tools)                               |
| `src/shared`              | Zod routes and shared types                                              |
| `src/bridges`             | Socket / JSON-RPC helpers                                                |
| `migrations/`             | SQLite migrations — [migrations/AGENTS.md](migrations/AGENTS.md)         |
| `tests/`                  | Unit, contract, integration, e2e — [tests/AGENTS.md](tests/AGENTS.md)    |
| `scripts/`                | Native rebuild, bundles, test runners, `check.sh`                        |
| `resources/`              | App icons — [resources/AGENTS.md](resources/AGENTS.md)                   |
| `docs/`                   | User guide, architecture, contributing                                   |
| `electron.vite.config.ts` | Builds main, preload, renderer (main includes runtime, bridges, workers) |
| `electron-builder.yml`    | Packaging; `publish: null`                                               |

Build output is `out/`. Packaging writes `release/`. Do not commit `out/`, `release/`, credentials, `.env` secrets, or Playwright output (`test-results/`, `test-results-*`, `playwright-report/`).

## Commands

Requires Node.js 24 or newer, npm, and Git. Use the committed lockfile.

| Step        | Command                                     |
| ----------- | ------------------------------------------- |
| Install     | `npm ci`                                    |
| Lint        | `npm run lint` (Prettier `format:check`)    |
| Typecheck   | `npm run typecheck`                         |
| Test        | `npm test`                                  |
| Single test | `npx vitest run tests/unit/secrets.test.ts` |
| Build       | `npm run build`                             |
| Local check | `bash scripts/check.sh`                     |

Other scripts: `npm run dev`, `npm run test:e2e`, `npm run verify` (typecheck, lint, unit tests, and build; `preverify` runs `scripts/check-node.mjs`), `npm run check` (full local gate including integration harnesses and Playwright). See [scripts/AGENTS.md](scripts/AGENTS.md).

## CI

The repository is public and CI uses GitHub-hosted runners. In `.github/workflows/ci.yml` on `main`, pull requests and pushes to `main` run `ubuntu-latest` only. `windows-latest` and `macos-latest` run only on `v*` tags and `workflow_dispatch`.

## Conventions

- Prettier (`.prettierrc.json`): single quotes, semicolons, trailing commas, width 100. No ESLint.
- Source is Elastic License 2.0 (`LICENSE`). Do not relicense.
- Stay in the subsystem you change; see nested `AGENTS.md` for import and SQL boundaries.
- Migrations are additive only ([migrations/AGENTS.md](migrations/AGENTS.md)).
- Windows x64 is the primary ship target; preview builds are unsigned with no auto-update.

## No-go zones (unless the task names them)

| Area                                    | Where                                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Credentials and `safeStorage`           | [src/main/AGENTS.md](src/main/AGENTS.md)                                                                                                      |
| Usage / billing display                 | [src/runtime/AGENTS.md](src/runtime/AGENTS.md)                                                                                                |
| Auto-update, signing, release mechanics | No `electron-updater` or publish feed; unsigned zip on `v*` tags only; keep SHA-256 step in CI; do not use electron-builder `portable` target |
| Brand, theme, copy                      | [src/renderer/AGENTS.md](src/renderer/AGENTS.md), [resources/AGENTS.md](resources/AGENTS.md)                                                  |

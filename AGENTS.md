# AGENTS.md

Multiclient is a local-first Windows desktop client for AI conversations and project work. It is an Electron app written in TypeScript and React, with one small C# helper for Windows process supervision. This file is the map for code changes: processes, directories, IPC, commands, conventions, and areas that are off limits unless a task names them explicitly.

Deeper narrative lives in [docs/architecture/README.md](docs/architecture/README.md), [docs/contributing/README.md](docs/contributing/README.md), and [SECURITY.md](SECURITY.md). Prefer those documents over guessing when a boundary is unclear.

## Processes

The app is several processes with a hard trust split. The renderer cannot reach Node, Electron, or SQLite.

| Process | Entry | Role |
| --- | --- | --- |
| Main | `src/main/index.ts` | Browser window, privileged IPC, OS dialogs, `safeStorage` credentials, `app://` and `media://` protocols, exports, backup/restore, artifact preview windows. |
| Preload | `src/preload/index.ts` | `contextBridge` surface `window.desktop`. Named calls only. |
| Renderer | `src/renderer/src/main.tsx`, `src/renderer/App.tsx` | Sandboxed React + Zustand UI. `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. |
| Runtime | `src/runtime/index.ts` | Electron utility process (`utilityProcess.fork`, service name `Multiclient runtime`). Owns SQLite, provider adapters, terminals, research, artifacts, and workspace tools. |
| Claude permission bridge | `src/bridges/claude-permissions/index.ts` | Local socket helper. Forwards approval requests; denies them when the host is unavailable. |
| Workspace tools bridge | `src/bridges/workspace-tools/index.ts` | JSON-RPC helper for folder-project tools. |
| Research parser worker | `src/runtime/research/parser-worker.ts` | Bounded HTML/PDF extraction. |
| Diagram preview | `src/renderer/artifact-diagram.ts` | Separate restricted window. Bundled to `out/main/artifact-diagram.js`. No Node, scripts, navigation, or network. |
| Windows supervisor | `src/main/native/RuntimeSupervisor.cs` | C# Job Object helper. Windows only. See below. |

`src/main/runtime.ts` (`RuntimeHost`) starts the utility process, forwards events to the renderer, and asks main for secrets. On Windows it enrolls that process in the C# supervisor before provider work. Elsewhere, exit cleanup uses `terminateProcessGroups` in `src/main/supervisor.ts`. A fatal runtime exit rejects pending calls, closes owned provider processes, and attempts one automatic recovery. Nothing replays a prompt, research request, command, or approval.

Provider CLIs (Codex stdio JSON-RPC, Claude Code NDJSON, Cursor ACP) and the user terminal (node-pty) are child processes of the runtime. They run as the logged-in user. API Chat speaks HTTPS SSE and has no local execution tools.

## C# supervisor

`RuntimeSupervisor.cs` is the only C# source. `scripts/build-supervisor.cjs` compiles it with the .NET Framework `csc.exe` (`Framework64\v4.0.30319`) and only when `process.platform === 'win32'`. Output is `out/main/runtime-supervisor.exe`. `electron-builder.yml` copies that exe to `runtime-supervisor.exe` in the Windows package resources.

`WindowsJobSupervisor.attach(pid)` spawns the exe with the runtime pid. The helper creates a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`0x00002000`), assigns the process, prints `READY`, and blocks on stdin. Closing stdin or killing the helper closes the job and terminates the runtime and its descendants. It is not a general sandbox and it is not built on Linux or macOS.

## Directories

| Path | What belongs here |
| --- | --- |
| `src/main` | Electron main process. Includes `secrets.ts`, `runtime.ts`, `supervisor.ts`, `artifacts.ts`, `history.ts`, `media.ts`, `clipboard.ts`, `native/`. |
| `src/preload` | Desktop API. Feature factories live in `src/preload/features/`. |
| `src/renderer` | UI: `features/`, `components/`, `appearance/`, `state.ts`. No Node and no direct IPC. |
| `src/runtime` | Utility-process domain code: `storage/`, `conversations/`, `providers/`, `files/`, `git/`, `terminals/`, `context/`, `memory/`, `research/`, `artifacts/`, `organization/`, `comparison/`, `permissions/`, `transports/`. |
| `src/shared` | Zod contracts and types (`schema.ts`, `types.ts`, `defaults.ts`, feature modules). No Electron, no React, no SQL. |
| `src/bridges` | Out-of-process helpers compiled as extra main-process inputs. |
| `migrations` | Additive SQLite migrations. Applied by numeric version inside a transaction. Numbers need not be contiguous (there is no `006`). Current highest version is 9. |
| `tests/unit`, `tests/contracts` | Vitest. Default `npm test`. |
| `tests/integration` | Node harnesses compiled by electron-vite and launched by `scripts/test-*.cjs` after a build. |
| `tests/e2e` | Playwright against the Electron app. |
| `tests/live` | Opt-in live provider tests (`vitest.live.config.ts`). Not part of `npm test` or CI. |
| `scripts` | Native rebuild, supervisor compile, diagram bundle, integration runners. |
| `resources` | App icons (`icon.png`, `icon.ico`, `icon.svg`). |
| `docs` | User guide, architecture, contributing, provider compatibility. |

electron-vite (`electron.vite.config.ts`) builds main, preload, and renderer separately. Main inputs include the runtime, both bridges, the research worker, and the integration harnesses. Packaged output is `out/`; the Windows portable EXE is `release/Multiclient.exe`. `electron-builder.yml` sets `publish: null`.

## IPC

There is no generic IPC bridge.

1. Preload calls `ipcRenderer.invoke('multiclient:' + route, input)` and listens only on `multiclient:event`.
2. `contextBridge.exposeInMainWorld('desktop', api)` is the renderer's only capability. Feature modules in `src/preload/features/` add named methods the same way.
3. Main accepts an invoke only from the main window's main frame (`trustedSender` in `src/main/index.ts`). Packaged origin is `app://client`. Development origin is `ELECTRON_RENDERER_URL`.
4. Routes listed in `publicRoutes` are parsed with the Zod schema in `src/shared/schema.ts` (`routes[route].parse`) and forwarded with `RuntimeHost.request`. Dialogs, credentials, backup, theme, and external URLs have their own `multiclient:*` handlers in main and do not go through that table.
5. Main and the utility process talk with `postMessage`. Runtime replies `{ type: 'response', id, result | error }` and emits `{ type: 'event' }`. It also sends `ready`, `fatal`, `owned-process`, `release-process`, and `secret`.
6. Credential bytes stay in the main process. The runtime sends `{ type: 'secret', requestId, providerId }`; main answers with the value. The runtime does not read the credential directory.

New features extend the named Zod contract in `src/shared`, the runtime dispatch, and a preload factory. Do not pass a raw `ipcRenderer` or a free-form channel string into the page.

## Commands

Requires Node.js 24, npm, and Git. Use the committed lockfile. `npm ci` runs `postinstall` (`node scripts/native.cjs`), which rebuilds `better-sqlite3` against Electron's ABI and, on Linux, `node-pty` as well.

```sh
npm ci
npm run dev
npm run build
npm test
npm run test:e2e
```

| Script | Exact command | What it does |
| --- | --- | --- |
| Install | `npm ci` | Clean install from `package-lock.json`, then native rebuild. |
| Dev | `npm run dev` | `electron-vite dev`. |
| Build | `npm run build` | `tsc --noEmit && electron-vite build && node scripts/build-artifact-renderer.cjs && node scripts/build-supervisor.cjs`. The C# step no-ops off Windows. |
| Unit tests | `npm test` | `vitest run`. Includes `tests/unit/**/*.test.ts` and `tests/contracts/**/*.test.ts`. Timeout 10s, max 2 workers (`vitest.config.ts`). |
| End to end | `npm run test:e2e` | `npm run build && playwright test`. Specs in `tests/e2e`, 1 worker, 60s timeout (`playwright.config.ts`). |

Related commands that already exist:

```sh
npm run typecheck
npm run format:check
npm run check
```

`npm run typecheck` is `tsc --noEmit`. `npm run format:check` is Prettier. `npm run check` is the CI gate: typecheck, unit/contract tests, production build, the storage/history/features/comparison/artifacts/web-worker harnesses, and Playwright. On Linux, Electron needs a display; CI runs `xvfb-run --auto-servernum npm run check`. History acceptance alone is `npm run test:history`.

Packaging: `npm run pack` (unpacked dir), `npm run dist`, `npm run dist:win` (unsigned portable x64 EXE, `--publish never`). Live provider tests are not scripted; the config is `vitest.live.config.ts`.

## Conventions

- Formatting is Prettier (`.prettierrc.json`): single quotes, semicolons, trailing commas, print width 100. There is no ESLint config.
- Stay inside the subsystem you are changing. `src/shared` cannot import Electron. Provider adapters cannot import React. Only storage modules execute SQL.
- Contracts are Zod schemas, usually `.strict()`. Add a route, a preload method, and a runtime handler together.
- Normalized provider events represent real behavior. Do not pretend every adapter supports the same tools.
- Tests use local fake providers. The test provider is selected only through the launch environment (`MULTICLIENT_TEST_MODE`, `MULTICLIENT_TEST_DATA`). Do not add a UI control that sets that environment or bypasses permission gates.
- Public write modes follow the provider/version/OS certification matrix. Synthetic or skipped live tests do not unlock them.
- Migrations are additive SQL files under `migrations/`. Do not rewrite applied history.
- Do not commit credentials, `.env` secrets, local databases, raw provider transcripts, `out/`, `release/`, or Playwright output (`test-results/`, `playwright-report/`).
- Windows x64 is the first shipping target. The preview EXE is unsigned and does not auto-update.

## No-go zones

Do not modify these unless the task explicitly tells you to change that area. Drive-by refactors, "cleanups", and test-only shortcuts here are out of scope.

### Key and credential storage

`src/main/secrets.ts` is the credential store. API and Brave Search keys use Electron `safeStorage` when a real OS backend exists. Linux `basic_text` is not treated as secure; those keys stay in process memory only. Files are written under `userData/credentials` with a temp file, mode `0o600`, then renamed. CLI subscription credentials stay with the official CLIs and are rejected by `Secrets.set`.

Also leave alone: `multiclient:saveCredential`, `multiclient:webSaveCredential`, `multiclient:login`, the runtime `secret` request/response, and any path that copies secrets into SQLite, exports, backups, diagnostics, or child-process environments. Child environments are an allowlist in `src/runtime/providers/process.ts` (`childEnvironment`).

### Usage and billing logic

Provider usage is reported, not billed, by this app. Do not change how usage windows are parsed, how remaining percent is shown, or which billing source a connection uses.

- Codex limit parsing: `src/runtime/providers/codex/usage.ts` (`parseCodexUsage`).
- Usage events from API, Claude Code, and Codex adapters under `src/runtime/providers/`.
- Settings UI: `src/renderer/components/ConnectionUsage.tsx`.
- Comparison consent and per-target usage in `src/shared/comparison.ts` and `src/runtime/comparison/`.

API billing is separate from CLI subscriptions. Comparison runs two or three API calls only after an explicit send.

### Auto-update and signing

There is no auto-update. Do not add `electron-updater`, a publish feed, or a startup update check. `electron-builder.yml` has `publish: null`. CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and publishes an unsigned portable EXE only for `v*` tags, as a prerelease. Signing and notarization stay outside the repo. Do not change the portable target, artifact name `Multiclient.exe`, or the checksum step in `.github/workflows/ci.yml`.

### Brand and UX

Product name, voice, theme, and layout are intentional. Do not restyle, rename, or swap copy as part of an unrelated change.

- Icons: `resources/icon.png`, `resources/icon.ico`, `resources/icon.svg`.
- Provider marks: `src/renderer/assets/providers/`. They are third-party brand assets; terms are in `THIRD_PARTY_NOTICES.md`.
- Theme and chrome: `src/renderer/appearance/` (`global.css`, `Background.tsx`), `src/renderer/App.module.css`, `appearanceSchema` in `src/shared/schema.ts`.
- Visible product strings in `src/renderer/` (welcome, settings, empty states).

Themes are validated settings JSON. Executable CSS or JS in a theme is not supported. Accessibility behavior (keyboard order, contrast, 800×600 at 200% zoom) is covered by `tests/e2e/accessibility.spec.ts`; do not loosen those checks to make a layout change pass.

# Runtime (`src/runtime`)

Electron utility process (`utilityProcess.fork`, service name `Multiclient runtime`). Entry: `index.ts`. Owns SQLite, provider adapters, terminals, research, artifacts, workspace tools, and related domain code.

Subsystems include `storage/` (only modules here execute SQL), `conversations/`, `providers/`, `files/`, `git/`, `terminals/`, `context/`, `memory/`, `research/` (including `parser-worker.ts` for bounded HTML/PDF extraction), `artifacts/`, `organization/`, `comparison/`, `permissions/`, `transports/`.

Main talks to runtime via `postMessage`. Runtime replies `{ type: 'response', id, result | error }`, emits `{ type: 'event' }`, and may send `ready`, `fatal`, `owned-process`, `release-process`, or `secret`.

Provider CLIs (Codex stdio JSON-RPC, Claude Code NDJSON, Cursor ACP) and the user terminal (`node-pty`) are child processes of the runtime, running as the logged-in user. API Chat uses HTTPS SSE and has no local execution tools. Child environments are an allowlist in `providers/process.ts` (`childEnvironment`).

Normalized provider events must reflect real adapter behavior; do not pretend every adapter supports the same tools. Public write modes follow the provider/version/OS certification matrix; synthetic or skipped live tests do not unlock them.

## Usage and billing (no-go unless tasked)

Usage is reported, not billed. Do not change parsing of usage windows, remaining-percent display, or billing source selection.

- Codex limits: `providers/codex/usage.ts` (`parseCodexUsage`).
- Usage events: API, Claude Code, and Codex adapters under `providers/`.
- Comparison consent and per-target usage: `src/shared/comparison.ts` and `comparison/`.

API billing is separate from CLI subscriptions. Comparison runs two or three API calls only after an explicit send.

# Architecture

## Trust and process boundaries

`src/renderer` is a sandboxed React/Zustand UI. `src/preload` exposes named commands and filtered events, never Electron or a generic IPC primitive. `src/main` validates frame ownership, schemas and URL destinations. It owns native dialogs, secure credential storage, media serving, static artifact windows and exports. `src/runtime` runs in an Electron utility process and owns SQLite state, provider adapters, workspace tools and research capture.

Storage repositories execute SQL; feature repositories receive the existing Store/database rather than creating another database. Only the main process decrypts API/search keys, supplying the selected key on demand. Secrets and prepared authenticated request bodies are not saved in feature tables or exports. CLI and PTY environments use an OS-environment allowlist. The runtime is a crash boundary, not an OS sandbox.

Windows provider process ownership lives in the main process through the kill-on-close Job Object supervisor. Runtime descendants must be enrolled before provider execution. Terminals are owned by their workspace and survive hidden panels or conversation selection; explicit Close, workspace trust revocation/removal and application exit terminate affected processes. Non-Windows process-group support still requires its own lifecycle certification.

## Data ownership

A project has explicit `folder` or `chat` kind. Folder projects own canonical directory workspaces, including managed Git worktrees. Chat projects have no workspace, path or filesystem trust. Conversation project/workspace identity stays separate; existing folder projects and workspace IDs are preserved by migration. Nested registrations in one Git checkout share the active-agent guard; distinct worktrees can run independently.

Conversations own ordered visible timelines of provider sessions and turns. A provider/model/mode/configuration change requires an explicit handoff and fresh session. Provider-native state is not translated between protocols. Branches preserve copied messages/assets and exact source/artifact references, exclude later history and start fresh native sessions. Branching never rolls back filesystem work.

User submissions are durable before provider dispatch. Normalized text events and message projections commit together; streamed deltas flush every 50 ms or at tool/interaction boundaries. UI refreshes merge loaded pages by identity and use request/conversation guards. Draft writes serialize per conversation/new-chat context, including captured attachments and selected controls. Settings patches serialize rather than replacing stale whole settings.

`context_items` holds mutable project instructions, notes/documents, manual memory and reusable source metadata. `context_snapshots` holds immutable, revisioned copies. Draft `contextRefs` pin snapshot IDs and inclusion/review state; `excludedContextSnapshotIds` records explicit exclusions. Submitted snapshots are preserved in message blocks and portable conversation JSON. Library edits/removal do not rewrite history or unsent snapshots; stale, not-yet-shared snapshots require explicit review. Sources from another project are refused unless already part of that conversation's captured history.

Selected API instructions use a separate system-instruction channel, independent of deselecting their original history message. Other sources follow the selected sharing messages. Native CLI instructions are included when a fresh native session starts; previously delivered native context cannot be removed by changing a renderer checkbox. Exclusion requires a fresh conversation with a reviewed handoff. Source text cannot grant execution permissions or modify native project instruction files.

Send-time limits are enforced below the renderer: up to 30 context references/300,000 source characters, 10 notes/documents/200,000 characters, and eight web sources/80,000 characters. Individual instructions support 20,000 characters, manual memory 10,000, and other library text 100,000. Existing attachment/request limits still apply; API preparation checks combined text up to 500,000 characters and model input capabilities. These are application bounds, not token accounting or guarantees of a model's context window. No automatic RAG retrieval, memory extraction or silent history trimming is implemented.

## Feature contracts and persistence

Feature APIs extend the named, Zod-validated desktop contract. Preload factories construct only named invocations; runtime dispatch uses corresponding feature schemas.

| Feature                | Contract and owner                                                   | Persistence/behavior                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects and knowledge | `shared/context.ts`, runtime context repository                      | `createChatProject`, context item CRUD, snapshot capture, project defaults and conversation source summaries; optimistic revision checks.                  |
| Manual memory          | `shared/memory.ts`, runtime memory handlers                          | Shares the context repository; global/project scopes, explicit opt-in defaults and source-message provenance. Deletion preserves already shared snapshots. |
| Web research           | `shared/research.ts`, runtime research service                       | Explicit Brave search and public-page capture. Search-result metadata stays transient; immutable fetched text/provenance uses context snapshots.           |
| Artifacts              | `shared/artifacts.ts`, runtime artifact repository and main handlers | Immutable revisions, autosaved drafts with generation checks, exact message/revision links, fork/restore and portable export.                              |
| Tags and templates     | `shared/organization.ts`, runtime organization service               | Batched tag enrichment; tag predicates precede FTS result limits. Text-only templates use revision checks and explicit stale-draft-safe application.       |
| Comparison             | `shared/comparison.ts`, runtime comparison service/repository        | Two or three API targets, persisted child conversations/group metadata, selected immutable input and independent cancellations/errors.                     |

Additive migrations are `005_context_library.sql`, `007_artifacts.sql`, `008_organization.sql` and `009_comparisons.sql`; filenames need not be contiguous. Migration application uses each numeric version and a transaction, preserving existing history. Backup validation accepts supported schema versions, checks version-specific tables, migrates a staged profile and validates references before replacing current data. The current highest schema version is 9.

FTS5 indexes stored message text and titles, including unloaded history and optionally archived chats. Tags are flat, global labels with a conversation join table, not a second project hierarchy. Branches copy associations. Portable conversation JSON stores tag names and captured context/artifact data; importing resolves names and remaps local IDs without enabling library memory defaults. Whole-profile backup includes live libraries, artifact drafts and comparison metadata plus registered assets, excluding credentials. Native provider session files remain separate.

## Adapters

Codex uses stdio JSON-RPC, Claude uses NDJSON plus a local permission bridge, Cursor uses stdio ACP, and API Chat parses SSE. Provider events map into text, tool, session, usage and warning events. API request preparation centralizes endpoint/authentication, asset validation, supported model inputs and context budgets. Aggregate SSE size checks apply across a stream. Connection revisions prevent an endpoint edit from silently redirecting an existing session. Provider interfaces are internal, not a third-party plugin SDK.

The interaction broker correlates requests to a live turn and accepts one response. Required questions use typed option/free-text answers. Ask mode rejects requests for extra permissions. Public modes obey the provider/version/OS certification matrix; synthetic tests or skipped live tests cannot enable uncertified write modes. API Chat has no local execution tools.

Comparison prepares every target without inference, using the same selected history, attachments, source/artifact snapshots and an explicitly selected PDF delivery policy. It validates all models, endpoints and credentials, then pins request bodies/configuration revisions in memory for five minutes. Explicit start revalidates revisions/context before dispatch. Closing its view does not cancel active calls. Runtime restart discards pending preparations rather than replaying them; saved child history and partial results remain recoverable. Continuation creates a normal immutable branch.

Research accepts only public HTTPS hostnames on port 443. DNS resolves all A/AAAA results, rejects unsafe address sets and pins the selected public address into the request; up to three redirects repeat validation. Cookies, browser authentication, JavaScript rendering and arbitrary request headers are not exposed to the renderer. Download bounds apply to encoded/decoded data, including batch consumption on failures. HTML/PDF extraction runs in bounded workers. Search snippets are never supplied as fetched model evidence. Captured paragraph tokens are audited against actual submitted sources; invalid tokens remain unresolved. Citation validation establishes provenance, not factual entailment. Brave storage-rights requirements are linked in the user guide.

## Files and media

Filesystem previews resolve real paths against the selected workspace and check text/binary bounds. Imported media uses opaque UUID names in `userData/assets` and is served only after database registration. Artifact HTML/SVG/text/code/Markdown previews run without Node/preload, scripts, navigation, downloads or external requests. Mermaid alone uses the bundled renderer in a separate restricted window, yielding static SVG. Renderer initialization has a separate 30-second deadline; diagram execution retains its five-second deadline. Either failure destroys the window and cleans its temporary files. Artifact source is bounded to 100,000 UTF-8 bytes; only validated revision-owned images are embedded. Neither preview nor AI revision requests execute output or write project files automatically. Theme files contain validated settings; executable CSS/JS is not supported.

The SQLite database and native provider state are separate. Deleting a project registration never deletes its directory. Native provider session retention is outside the app's control.

## Build and lifecycle

electron-vite builds independent main/runtime/preload and bounded worker entry points. electron-builder packages native modules outside ASAR. There is one main renderer and one runtime; feature modules retain React, Zustand, Electron, SQLite and existing adapter boundaries.

Fatal runtime failure rejects pending requests and closes owned provider processes. The main process attempts one automatic recovery, rehydrates saved state, then offers manual recovery after another failure. Startup marks unfinished turns interrupted and pending approvals cancelled. A crash may lose the uncommitted streaming tail; no recovery path replays prompts, research requests, commands or approvals automatically.

The complete source check passed typecheck, 226 unit/contract tests, all native/worker harnesses and 41 desktop scenarios. The final Windows package separately passed all 41 desktop scenarios; one live Codex case was skipped in each run. Final portable launch/streaming/restart/exit and public-HTTPS capture through the packaged UI, submission to a local API and persistence without replay also passed. [Feature acceptance](../features-acceptance.md) maps requirements to tests, and [implementation status](../implementation-status.md) records results, timings and the unsigned artifact checksum. Windows x64 remains the first target. Live provider/Brave account certification, signing and consented human usability testing remain separate gates. The application keeps its no-telemetry default.

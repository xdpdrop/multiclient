# Implementation status

Updated October 13, 2026. This is an unsigned Windows development preview, not a certified public beta. Source implementation, deterministic verification and live-account certification are separate claims. The complete source check, repeated packaged desktop suite and final portable smoke passed; earlier public-web smoke evidence is recorded separately.

## Implemented capabilities

- Official CLI adapters for Codex App Server, Claude Code NDJSON and Cursor ACP; retained and restored OpenAI Responses, Anthropic Messages and compatible API Chat. Subscription credentials stay with the original CLIs; API credentials use OS-backed encryption or memory fallback.
- API/local endpoint setup, bounded authenticated model discovery, custom model IDs, Ollama/LM Studio presets and explicit token-using connection tests. One connection per provider; one compatible endpoint.
- Persistent drafts, pinned/archive history, database-backed message/title search and navigation to unloaded results. Conversation branches/edit-and-resend preserve original history and attachment snapshots; a branch starts with no copied native session ID.
- Captured UTF-8 text, PNG/JPEG/WebP and PDF assets; PDF.js extraction by page. Native cloud image/document request formats are covered by deterministic tests. Selected PDF pages and compatible/CLI PDF fallback are labeled extracted text, not full visual document understanding.
- Project files/instruction sources, Git review and selected diffs, worktree records and terminal workspace isolation. Rich failures retain partial responses and suggested recovery. Questions/approvals are validated against the live turn.
- Appearance, font/density and opt-in notifications; serialized settings patches. The runtime has bounded crash recovery and process supervision, without replaying a model turn or permission response.
- Conversation Markdown/JSON/PDF exports and import; online SQLite profile backup, validated staged restore and rollback. Credentials remain outside exported profile data. Restored project trust must be renewed.
- Folderless chat projects alongside filesystem-backed projects; reusable instructions, notes and extracted text/PDF knowledge. Immutable captured revisions appear in the source manifest. API instructions stay separate from history selection; ordinary sources follow their sharing messages. Context is selected explicitly, without automatic RAG retrieval.
- Explicit public-HTTPS page capture and optional Brave Search with a user-supplied key. Search-result metadata is transient; fetched source text/provenance survives history/export/backup. Source-paragraph citations are checked against captured material supplied to the turn; they establish provenance rather than factual correctness. Native provider search tools remain disabled.
- Editable Markdown/code/text/HTML/SVG/Mermaid artifacts with immutable revisions, recoverable drafts, branch-pinned references, proposal review and export. Previews are static and isolated; generated code is not executed or automatically written to project files.
- Manual global/project memory notes with revision checks, source provenance and opt-in sharing in new chats. Deletion removes the library note without rewriting prior messages or erasing native provider context; fresh-chat workflows let users omit that context.
- Flat conversation tags combined with stored-content search, branch/archive/restore and portable tag-name import/export. Global/project text templates use explicit append/replace previews and preserve attachments, context selection and provider controls.
- Two- or three-target API model comparisons using the same reviewed prompt, saved history, attachments and source/artifact snapshots. Input support, connection revisions and usage consent are checked before starting; answers have independent failure/cancellation, and continuation creates an ordinary branch. No CLI parallel-execution guard is relaxed.

## Verification evidence

The complete `npm run check` exited successfully on the final stable source: typecheck, 232 unit/contract tests across 43 files, all native integration checks (storage, history, shared features, comparison, artifacts and compiled web workers), and 42 passing desktop scenarios. The one live Codex desktop case was skipped, for 43 total desktop cases, and remains unverified. The desktop run took 4.3 minutes; tests use no automatic retries. Earlier preview package evidence does not certify this rebuilt source.

The passing regression suites exercise Windows Job Object child/grandchild cleanup, runtime/helper/main-owner termination, one automatic runtime recovery, expired questions, manual recovery after another crash and no prompt replay. Desktop checks include keyboard-only interaction at 200% zoom in an 800×600 window, light/dark appearance and the six feature workflows.

The final Windows package passed every desktop scenario twice through `MULTICLIENT_PACKAGED_PATH` with `--repeat-each=2 --retries=0`: 84 passes and two skips of the live Codex case, for 86 total cases, in 9.4 minutes. Every scenario used a fresh profile. The suite covers the 10,000-message fixture, native import cancellation/error/retry, static previews, Mermaid, printable PDF, parser/attachment workers, assets, backups, recovery, PTYs and workspaces. The final portable EXE separately passed launch, streaming, saved-history restart and clean exit.

The [import investigation](import-investigation.md) reproduced a native swallowed-click mechanism in the former loading state and corrected tab-entry and query/action ownership races. It also fixed a project-creation test readiness race and separated diagram initialization from its unchanged five-second execution budget. Fifteen focused final-package runs passed: ten imports and five artifact workflows, including twelve-worker CPU load during portable compression, without test-timeout changes or retries. Main, renderer and diagram bundle bytes matched the verified build. The original isolated import failure lacked the event records needed for unique causal attribution; passing repetition is not presented as proof of its historical cause. Earlier broader failures and their traces remain recorded separately.

The final rebuilt `release/Multiclient.exe` is a 150,783,494-byte Windows x64 portable preview. Authenticode status is **NotSigned**. Its SHA-256, recorded in `release/SHA256SUMS.txt`, is `e064c5acdb464d31dde0c7693601d3872e123025eaac24d8c44077645b98a7b8`. That build predates the public remote. The repository is now hosted at [xdpdrop/multiclient](https://github.com/xdpdrop/multiclient) and changes land through pull requests. CI publishes an unsigned Windows x64 zip (`Multiclient-win-x64.zip` with `SHA256SUMS.txt`) as a prerelease for each `v*` tag; the latest is v0.1.1.

The general-chat guard suite has deterministic coverage for accumulated SSE limits, reader cancellation, context/output limits, provider failures/refusals, nested usage, system/attachment context, discovery/auth/base paths, native image serialization and selected-page text delivery. Credential tests exercise encrypted restart persistence, failed replacement preservation and memory/deletion behavior.

The compiled Electron attachment smoke test imports real text/image/PDF fixtures, decodes an image preview, reads asset media responses, extracts a two-page PDF, sends only the chosen page to a deterministic local endpoint, and verifies persisted attachment metadata. This validates Electron/PDF.js integration without paid inference.

An earlier packaged public-web smoke traversed the actual Electron UI and named preload/main/runtime/worker routes to capture a public RFC over HTTPS in 2,511 ms. Its 60,000-character source was explicitly marked truncated. All 196 captured paragraphs and their source markers appeared in the one actual local API request; the response citation persisted, and restart retained the same snapshot without another inference request. The run passed with no reported errors, no Brave key and no paid inference. Evidence is saved in `.cache/web-public-smoke-C2Vaju/evidence.json`. This verifies the end-to-end capture/submission path, not Brave or paid-provider account eligibility, and predates the focused import/diagram fix.

The storage/history acceptance harness is `npm run test:history`; it verifies immutable branches, unloaded and archived search, drafts across restart, session/configuration boundaries, export privacy, online backup, corruption rejection and failed-restore rollback. Its 10,000-message/10,000-tool-event fixture prints observed query/restart timings. Timings describe the machine that ran the command; they are not a performance guarantee.

Observed October 13 on Windows, Electron `44.4.5` / Node `24.21.0`, during the latest native history integration run:

| Synthetic fixture operation                                           | Observed time |
| --------------------------------------------------------------------- | ------------: |
| Insert 10,000 messages and 10,000 tool events                         |      6,660 ms |
| Read latest 100 messages and relevant tool activity, mean of 20 reads |       8.95 ms |
| Full-text search, mean of 20 reads                                    |      14.65 ms |
| Read/hydrate full 10,000-message transcript, mean of 3 reads          |      36.30 ms |
| Reveal the first saved message, mean of 20 reads                      |       9.89 ms |
| Reopen the database                                                   |      89.07 ms |

This measures storage operations on short synthetic text, not rendering an entire transcript, video/GPU load, actual model latency, or a universal responsiveness budget. The same acceptance run also verified failed-response metadata through JSON import, atomic imported-asset registration, credential-generation changes, preservation of an existing backup after asset-validation failure, staged-profile startup/migrations and successful backup replacement.

The new batched hydration regression verifies a 1,002-message transcript with nine queries, retaining native-session mappings, message blocks, source/artifact references and failure metadata. It exercises projection parity rather than relying on timing alone.

The passing real Electron 10,000-message desktop scenario measured 1,699 ms for import/first render, 128 ms for an earlier page, 231 ms from typing a search to its result, and 1,003 ms for a deterministic local streamed turn. It checks stable anchors, deduplication and Jump to latest. This final source run had no concurrent packaging or synthetic load. Local fixture latency does not represent paid-provider latency.

The two final packaged suite repetitions measured the same fixture at 1,885/1,650 ms for import/first render, 164/169 ms for an earlier page, 243/231 ms for search and 536/485 ms for streaming, after compression and synthetic load ended. Separate focused imports took 1,755–2,926 ms without synthetic CPU load during compression and 4,275–8,043 ms with twelve CPU workers plus compression. These are observed machine-specific timings rather than performance guarantees.

Provider-account evidence remains the [September 29 validation record](provider-compatibility/validation.md): Windows Codex `0.158.0` passed read/resume and partial approved/denied write checks. Claude `2.1.252` could not refresh OAuth; Cursor was absent. No new paid API call or completed cross-provider permission certification is claimed here.

## Release gates and remaining limits

- Public Code/Bypass are gated pending complete provider/version/platform permission certification; explicit development opt-in is available. Known Windows Codex has read-only evidence, while unknown CLI versions and unverified providers expose Ask. Do not describe a development bypass as sandboxed.
- Complete live provider/version permission certification and manual backup/restore QA with representative existing user profiles before release. Signing/notarization remain external credentials. Windows evidence does not certify macOS/Linux.
- Native CLI image payloads and arbitrary compatible-endpoint vision remain unsupported. PDFs have 10 MB/100-page extraction limits; Office/OCR and automatic RAG retrieval are deferred. API Chat does not execute local tools.
- Web capture requires public HTTPS sites; authenticated/browser-rendered/intranet research is unsupported. Brave account compatibility remains unverified. The passing public-URL/local-inference smoke does not certify paid search or inference accounts.
- Artifacts are static rather than interactive hosted applications. Memory is explicitly user-managed, without provider-side erasure guarantees. Comparison is API-only and incurs each selected provider's usage.
- Importing external native CLI/web histories, multi-account endpoint profiles, cloud sync, mobile access, autonomous provider routing and unattended scheduling are deferred. Lost native CLI state cannot be reconstructed merely from the visible transcript.
- Recruiting the 12-person [usability study](usability-study.md) and demonstrating repeated real-world use remain human rollout work. No testimonials, retention measurements or market validation have been fabricated.

See [the guide](guide.md) for setup, file/context limits, safety boundaries and reproducible verification commands.

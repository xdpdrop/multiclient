# Validation record — 2026-09-29

Development host: Windows x64. No live permission certification is claimed.

## October 12 implementation update

The September 29 evidence below is historical, not a claim of new paid-account testing. API Chat has been restored with guarded streaming, credential durability, model discovery and native cloud image/PDF request fixtures. A compiled Electron smoke test exercises real PDF.js extraction, image previews, asset media responses, selected-page-only text delivery to a local deterministic endpoint and persistence. No paid API inference was performed.

Public write/bypass modes now follow explicit provider/version/platform certification gates. The old Code/Bypass UI statements below describe the earlier development preview; current write-mode testing requires `MULTICLIENT_DEVELOPMENT_MODES=1`. The recorded partial Codex write successes do not fulfill the complete permission checklist.

Additional storage acceptance and the reproducible 10,000-message fixture run under Electron with `npm run test:history`; query timings are emitted by the harness and are specific to the machine running it. See [current status](../implementation-status.md) and [the guide](../guide.md) for current behavior and release prerequisites.

## Bypass mode validation

Bypass is implemented with native provider controls: Codex uses `never` approvals and `danger-full-access` sandbox policy on start, resume and every turn; Claude uses `bypassPermissions` and `--dangerously-skip-permissions` without the incompatible `--restricted` flag; Cursor uses `--force --sandbox disabled` and ACP agent mode. User questions and plan responses remain interactive. Unexpected blocking approvals are refused rather than automatically overriding provider policy. Sources: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Claude CLI reference](https://code.claude.com/docs/en/cli-reference), [Cursor parameters](https://cursor.com/docs/cli/reference/parameters).

Synthetic subprocess tests verify native options, unchanged normal-Code approvals, mode mismatch rejection and refusal of unexpected approval requests. SQLite tests verify saved Bypass conversations, native resume within the same mode and separate native sessions when returning to Code. UI tests verify the visible full-access indicator and reset on new conversations.

Live Bypass execution was **not performed**: automatic approval review rejected the unrestricted model test because it could affect files outside the disposable folder. Claude still needs renewed login and Cursor is absent. No successful live Bypass verification is claimed. The opt-in test additionally requires `MULTICLIENT_LIVE_BYPASS=1` and must not be run through a workaround to that rejection.

| Check                          | Result                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex `0.158.0` App Server     | Real initialize, effective configuration read and thread creation passed without inference. Server confirmed read-only sandbox with networking disabled and user approval routing.                                                                                                                                                                                             |
| Codex approval policy          | Installed CLI rejected the removed `untrusted` policy at startup. Adapter uses `on-request`, disables command/patch tools in Ask/Plan/Review and enables them in Code. The read-only sandbox is retained; Code can approve individual file/command requests. Inherited MCP servers are disabled, the bundled read service is enabled, and broad permission grants are refused. |
| Codex subscription turn/resume | Passed two live requests using directory listing and file reading, including changed contents after native resume.                                                                                                                                                                                                                                                             |
| Claude Code `2.1.252`          | Real restricted CLI invocation reached authentication. Request failed because the OAuth session expired and could not refresh. Streaming/resume remain unverified against the account.                                                                                                                                                                                         |
| Cursor                         | CLI not installed on this host. Live ACP validation remains pending.                                                                                                                                                                                                                                                                                                           |
| API adapters                   | Synthetic Responses/Messages tests cover streaming, truncation, quota errors and request fields. No paid API call performed.                                                                                                                                                                                                                                                   |
| Adapter contracts              | Synthetic subprocess peers cover Codex, Claude and Cursor streaming, native IDs, access refusal, unknown blocking requests, and Codex cancellation. These are not recordings of live provider runs.                                                                                                                                                                            |
| Storage                        | Real Electron/SQLite integration covers migration rollback, restart interruption, persisted attachments, duplicate submissions, pagination and cancellation.                                                                                                                                                                                                                   |
| Desktop                        | Playwright covers light/dark UI, restart persistence, trust, files, questions, PTY startup, hostile Markdown, video playback and GIF reduced motion.                                                                                                                                                                                                                           |
| Packaging                      | Windows unpacked application built and smoke-tested. Signing check reports NotSigned. CI `verify` runs on Windows, macOS and Linux (all three passed in run 38580511604 on `main`). `v*` tags publish an unsigned Windows x64 zip prerelease, latest v0.1.1.                                                                                                                   |

## Re-running live checks

Normal tests never use provider accounts. Build first. In a maintainer shell, set `MULTICLIENT_LIVE_PROVIDER` to `codex`, `claude-code`, or `cursor`, then run:

```sh
npx vitest run --config vitest.live.config.ts
```

This intentionally uses the selected CLI's existing account in disposable directories. It never reads credential files. The text test uses two small requests; Codex also has a two-request file-reading/resume test. For Codex's non-inference startup check only, append `--testNamePattern handshake`. For workspace tools only, append `--testNamePattern "reads project files"`.

### Workspace and response fixes

On September 29, the live workspace test passed on this Windows host: Codex called `list_directory` and `read_file`, returned a random marker read from the file, resumed the same native session and returned the changed marker. The newly configured MCP service is required at startup and added again on resume. Inherited MCP servers remain disabled. That read-only test did not enable command execution or write capability.

Unit/contract checks cover traversal and Windows junction escapes, excluded credential paths, oversized/binary files, unsupported tool calls, split message deltas, duplicate completion snapshots and separate commentary/final items. SQLite checks verify block order and restart persistence. Desktop checks verify selector alignment and progress/code-block rendering. Old local messages without item metadata are preserved unchanged.

### Code mode preview

Codex 0.158.0 passed two additional live tests on Windows: an approved native edit changed target.txt, a denied edit preserved it, an approved shell deletion removed a disposable target.txt, and a denied deletion preserved it. Each allow/deny pair resumes the same native session and reapplies permissions. No user project was changed. Re-run with `--testNamePattern "Code mode"`.

Claude 2.1.252 accepted the restricted/manual invocation but failed OAuth refresh; no authenticated Code execution is claimed. Cursor CLI is absent, so no live Cursor Code execution is claimed. Synthetic subprocess tests cover allow and deny for all three adapters, Codex wrong-thread refusal, broad permission refusal, and exact approval details. Code is available for development testing; the remaining inherited-policy, outside-workspace, crash and platform certification checklist remains a public-release gate.

The packaged Windows preview also passed a real desktop Codex test: select Code, submit a file creation request, verify the file does not exist while the approval card is pending, click Allow once, and verify the exact created content. It uses an isolated app profile and disposable project. Run with `MULTICLIENT_LIVE_DESKTOP=1` and `MULTICLIENT_PACKAGED_PATH` pointing to the preview executable, then `npx playwright test`. Normal desktop CI skips this subscription test.

# Provider compatibility and release gates

Updated 2026-10-12; live-account baseline remains 2026-09-29. Official documentation and installed CLI builds can differ. Deterministic adapter tests do not certify account access, billing, or permission enforcement.

| Adapter        | Transport                                | Authentication owner                   | Release status                                                                                                  |
| -------------- | ---------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Codex          | App Server JSON-RPC over stdio           | Official CLI / managed ChatGPT login   | Tested Windows 0.158.0 read-only modes; partial Code approvals verified, development-only write modes           |
| Claude Code    | `-p` NDJSON; local MCP permission bridge | Unmodified official CLI                | Public Ask; other modes development-only; OAuth refresh failed on 2.1.252                                       |
| Cursor         | Official ACP over stdio                  | Official CLI login                     | Public Ask; other modes development-only; CLI absent and live validation pending                                |
| OpenAI         | Responses SSE                            | User API key                           | Restored Chat; bounded streaming/model discovery and native image/PDF payload tests; no paid live-account check |
| Anthropic      | Messages SSE                             | User API key                           | Restored Chat; bounded streaming/model discovery and native image/PDF payload tests; no paid live-account check |
| Compatible API | Chat Completions SSE                     | Configured endpoint/optional local key | Restored text Chat and extracted PDF text; local-server presets; arbitrary native vision/tools not certified    |

CLI refresh checks installation/version and recognized sign-in status. API refresh checks configuration; model discovery sends a bounded authenticated catalog request without inference. Explicit API **Test connection** sends a small model request and may consume paid tokens. Neither a saved key nor an executable proves account/model eligibility.

Public Code and Bypass remain gated. The current matrix grants known Windows Codex `0.158.0` read-only modes; unknown CLI versions and unverified providers expose Ask. `MULTICLIENT_DEVELOPMENT_MODES=1` explicitly enables preview modes for disposable development testing. Partial approval tests are not complete sandbox certification.

## Attachment and authentication boundaries

Cloud image/PDF admission uses a conservative documented model-family allowlist; custom models are not assumed to support native vision. PNG/JPEG/WebP and original PDFs use provider-specific structured inputs. Compatible/CLI PDF routes are labeled extracted text; selected pages also use text-only delivery. Native CLI images and arbitrary compatible endpoint images are refused until supported payload behavior is verified.

Native Anthropic admission recognizes documented serving revisions: Sonnet 4.5/4.6/5/5.5, Opus 4.5–4.8/5/5.5, and Haiku 4.5/5.5, including dated snapshots where applicable. Retired Claude 3, original Claude 4 and Opus 4.1 IDs are excluded. Original Claude 3 image support did not imply native PDF support; historical Sonnet 3.5 PDF support is recorded in [Anthropic's release notes](https://platform.claude.com/docs/en/release-notes/overview). Current availability follows [model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations), reviewed 2026-10-12. This check selects a payload format; it does not certify account access or a paid live request.

Claude's official conditions distinguish user authentication in an unmodified Claude Code binary from third-party credential routing. Preserve the original binary and Anthropic-owned sign-in flow, do not collect subscription tokens, and review commercial/trademark conditions. Cursor ACP uses the subscription's usage-based pricing; do not promise unlimited inference. Multiclient does not turn web subscriptions into general chat APIs.

## Write-mode certification

Code mode is available only through explicit development opt-in. Codex approved and denied edits and shell deletion passed live on Windows 0.158.0, with permission settings reapplied on native resume. Claude and Cursor routing has synthetic protocol coverage only; their account-backed checks remain blocked. Before a public release, complete the remaining version/OS coverage and record effective settings and sanitized fixtures for:

1. File creation/edit/deletion: approval occurs before execution; denial prevents the action.
2. Arbitrary shell and Git reset/push: explicit approval, including inherited allow rules and hooks.
3. Writes outside the workspace and through symlinks/junctions: sandbox or permission refusal.
4. Concurrent requests, cancelled/stale approvals, runtime crash and disconnect: no implicit grant.
5. Session resume: permissions reapplied, no automatic command replay.
6. Native plan mode: workspace writes blocked until an explicitly supported transition.

Perform live probes only in disposable directories with the maintainer's own account. Never run live tests in untrusted PR CI or record credentials. Synthetic fixtures verify protocol routing, not provider enforcement. Provider policy and inherited command rules can affect whether a native approval is requested; do not describe UI approvals as complete host isolation.

## Sources

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Claude Code programmatic CLI](https://code.claude.com/docs/en/headless)
- [Claude CLI flags](https://code.claude.com/docs/en/cli-reference)
- [Claude integration and credential conditions](https://code.claude.com/docs/en/legal-and-compliance)
- [Claude hooks](https://code.claude.com/docs/en/hooks)
- [Cursor ACP](https://cursor.com/docs/cli/acp)
- [Cursor ACP subscription pricing](https://cursor.com/docs/integrations/jetbrains)
- [OpenAI native file inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [Anthropic PDF requirements](https://platform.claude.com/docs/en/build-with-claude/pdf-support)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [LM Studio model listing](https://lmstudio.ai/docs/developer/openai-compat/models)

Run `node scripts/generate-codex-protocol.mjs` deliberately when updating the tested CLI baseline, then review generated type changes. Never regenerate schemas implicitly on every install.

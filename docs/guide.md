# User and release guide

Multiclient keeps everyday AI chat and project work in one Windows desktop workspace. Conversations, drafts, settings and captured attachments stay in `%APPDATA%/multiclient`. Moving the portable EXE preserves that profile on the same computer; it does not move your profile or provider accounts to another computer.

**Unsigned development preview, not a certified public beta.** Provider capabilities vary. Editing modes remain gated until the provider/version/platform permission checklist is complete. No general ChatGPT or Claude web-subscription API is included. See [provider compatibility](provider-compatibility/README.md) and the [implementation status](implementation-status.md).

## Connect an AI provider

Open **Settings & connections** and enable the connection you want:

- **API Chat:** OpenAI API, Anthropic API, or a compatible HTTPS endpoint. Add your own key, fetch available models or enter a custom model ID, and save. API billing is separate from ChatGPT/Claude subscriptions. **Test connection (uses tokens)** sends a small, explicitly requested model call; Refresh and model discovery do not run inference.
- **Local server:** choose the Ollama or LM Studio preset in Compatible API, start that separately installed server, fetch models and save your selection. Loopback HTTP endpoints can omit a key. Multiclient does not download models or start the server for you.
- **Official CLI subscription:** install Codex, Claude Code or Cursor's official CLI and sign in through its own flow. Multiclient never takes ownership of subscription credentials. If browser login cannot complete, run `codex login`, `claude auth login`, or `agent login`, then refresh Connections.

One saved connection per provider is supported, including one compatible endpoint. Changing an endpoint, model default, executable or credentials can require a fresh session and an explicit context handoff. A stored key or installed CLI does not by itself prove model/account eligibility.

API Chat works without a project folder or CLI. Local history means local storage; a cloud provider still receives your prompt and selected context. A local server may itself use cloud models, depending on its configuration.

## Conversations and attachments

Drafts survive conversation switches and restart. Find older text with global search or within-chat find, including messages outside the loaded transcript. Pins keep useful conversations near the top. Archive preserves history; restore it from the archive view.

Edit-and-resend and branch actions create a separate conversation with provenance, leaving the original intact. A conversation branch does not undo file edits, roll back shell commands, or recreate a provider's private native session. Changing providers uses an explicit handoff rather than pretending their internal context formats are interchangeable.

The editable handoff preview transfers written messages and captured text context. It does not automatically transfer earlier image/PDF binaries. Reattach those assets when needed, or explicitly select saved history with an API connection to include its stored attachments.

Use the paperclip, supported drag/drop or clipboard image paste to capture files. Imported image/PDF bytes are copied into the app profile; text is captured with the message, so later changes to the original do not change the saved context.

- Up to 10 attachments per submission; each file is at most 10 MB. Anthropic images must also fit its base64-encoded limit, so images over 7.5 MB are rejected before dispatch. Text extraction is limited to 100,000 characters per file; combined request/context limits can require fewer files or a new conversation.
- PNG, JPEG and WebP images use native vision input only for the supported cloud model families. CLI image input and arbitrary compatible-endpoint vision are not certified and are refused with an explanation.
- PDFs are limited to 100 pages and must be unlocked. Supported cloud models can receive the original document. Other connections receive explicitly labeled extracted text where available. Scanned PDFs without extractable text require native document vision.
- Native Anthropic image/PDF input requires a recognized supported Claude Sonnet, Opus or Haiku model ID. Retired IDs and arbitrary custom names are excluded; PDF text extraction remains available. See the [documented model allowlist](provider-compatibility/README.md).
- Selecting PDF pages sends extracted text from those pages only. It does not send the complete original PDF; pictures, layout and charts are not preserved by this route.
- Office documents, arbitrary binary attachments, document OCR and automatic retrieval from a RAG knowledge base are not part of this preview. Project knowledge uses explicitly selected text snapshots.

Model and depth menus support keyboard navigation. Discovered model lists are provider responses, not a guarantee that every listed model works with every input. Custom IDs remain available when model listing is unsupported.

## Everyday projects and reusable knowledge

**Add project** offers a **Chat project** for related conversations, instructions and knowledge, or a **Folder project** for files, Git and terminal work. A chat project needs only a name. It has no filesystem workspace or implicit permission to run project tools. Existing folder projects keep their directory and workspace IDs.

Open **Add context and tools → Project knowledge** to create notes, maintain project instructions, or **Import text or PDF**. Knowledge PDF input is extracted text, with explicit page selection; it does not supply document pictures or layout. Importing a document captures its contents locally. Select sources, then choose **Add selected sources to conversation**. Optional **Include this source in new chats** initializes future chats; it does not rewrite saved chats or existing unsent drafts. Project provider/model defaults and reusable starter prompts remain separate controls.

The composer **Sources** disclosure shows the captured revision and lets you preview or exclude each source. Updating or removing a library item preserves previously shared copies. If an unsent snapshot is stale, explicitly choose **Use captured version** or select the updated source. New material is not silently substituted into a draft.

For API Chat, selected project instructions are supplied separately from ordinary history and remain available when their original sharing message is deselected. Notes, documents, memory and web sources follow their sharing messages and explicit source exclusions. Native CLIs retain private session context: instructions are supplied when a fresh session starts, and excluding previously shared context requires a fresh chat with a reviewed handoff. Library instructions never grant filesystem execution permission or modify project instruction files.

There is no automatic retrieval, embedding index or model-written knowledge. Each instruction note is limited to 20,000 characters; other project notes/documents to 100,000 characters each. Selected notes/documents support up to 10 sources and 200,000 characters. All selected shared sources together support up to 30 references and 300,000 characters, within the overall request limit. Character counts are not token estimates; provider context limits can be lower.

## Web sources

Open **Add context and tools → Web sources** to capture public HTTPS pages. **Read URL** works without a search key. **Search** uses your separately configured Brave Search API key and search credits. Search snippets remain transient; select results and read their pages before choosing **Use selected sources** to add captured text to the draft. Searching and fetching do not send a model prompt; search and inference have separate billing.

Capture supports readable HTML, UTF-8 text and unlocked PDFs with extractable text. It does not sign in to sites, execute page scripts, bypass paywalls, or read local/private network addresses. Up to eight pages can be captured per batch; limits are 2 MB per HTML/text page, 10 MB per PDF, 20 MB per batch, and 60,000 extracted characters per source. Extraction truncation is shown. Selected web context is limited to eight sources and 80,000 characters.

Captured sources keep the URL, capture time and immutable text. Refresh by capturing the URL again; earlier citations keep their saved version. Source references open the captured paragraph, with a separate action to open the original site. References establish provenance, not independent verification of a claim. Unresolved references and answers without source citations are labeled.

Selected sources work as explicit text context with API chat and reviewed CLI handoffs. Native provider search tools remain disabled. Closing the Web sources dialog or switching drafts cancels active capture; cancellation and restart never replay research requests automatically. Capture accepts public HTTPS hostnames on port 443 without embedded credentials. Each fetch times out after 15 seconds and a batch after 45 seconds. Search displays up to 10 results; queries support 600 characters and 75 words.

Brave's [Search API FAQ](https://brave.com/search/api/) states that storing API results requires a plan explicitly granting storage rights. This preview saves independently fetched page snapshots rather than search-result records. Search access also grants no rights to third-party page content.

## Saved memory and organization

**Add context and tools → Memory** opens **Saved memory**, containing notes you explicitly create or save from a message. Choose **Global** or **This project**, review the text, and use **Add to draft** to share it. **Include in new chats** is off for a new note. Enabling it for a global note deliberately includes that note in future personal and project chats. Project notes are scoped to their project. Notes support 10,000 characters and retain captured revision/source information.

Editing or deleting memory changes the library; existing messages, exports, backups and native sessions can retain earlier copies. **Start fresh without memory** creates fresh conversation context, allowing you to leave those copies behind. It does not erase provider-side records or rewrite saved history. There is no automatic memory extraction or hidden model-managed memory.

Use **Conversation options → Manage tags** to assign up to 20 flat labels to a chat. **Filter chats by tag** narrows the sidebar; history search combines tag, project, provider and archive filters before selecting results. Multiple selected search tags require all selected tags. Renaming a tag changes its label everywhere; deleting a tag removes the label without deleting conversations. Branches and archive/restore preserve tag associations.

**Add context and tools → Prompt templates** opens a global/project library of reusable prompt text. Create a template or **Save draft as template**, then **Preview application** and explicitly append or replace the draft text. Applying preserves attachments, selected context, provider/model/mode/effort and performs no inference. If the conversation or draft changed during preview, reopen the preview. Templates contain text, without executable macros or automatic provider switching; project defaults remain the place to remember provider controls.

## Versioned artifacts and model comparison

Choose **Save answer as document** on a completed answer, **Save as artifact** on a code block, or open **Artifacts** to create a named Markdown, code, text, HTML, SVG or Mermaid output. The **Source** tab edits its working draft; the **Preview** tab opens the selected saved revision in an isolated window. Inspect **Compare source** and **Save revision**. Drafts recover after restart; revisions remain immutable. **Restore as new revision** preserves later history. A branch pins the referenced revision and requires a fork before editing it.

**Static preview** renders the selected saved revision in an isolated window. HTML/SVG scripts, external resources, navigation and local filesystem access are disabled; code is displayed rather than executed. Mermaid uses the bundled renderer with restricted configuration. These are static artifacts, not hosted interactive React applications. Source is limited to 100,000 UTF-8 bytes; authorized local images are limited to 32 MB per artifact revision/preview.

**Attach this revision** supplies its exact saved source as context. **Ask to revise saved artifact** prepares an ordinary prompt; sending uses the selected provider and normal billing. Review the model's proposed source before saving a revision. Nothing automatically writes project files or runs generated code. Export offers source, printable PDF, JSON and SVG where supported. Artifact JSON preserves revision history and assets; profile backup also includes saved artifact drafts.

**Add context and tools → Compare models** sends the same reviewed prompt/context to two or three distinct API provider/model targets. Select persisted history and PDF delivery, inspect the additional usage notice, then choose **Send to N models**. Every target must support the selected inputs. Prepared request bodies and connection revisions are pinned; incompatible inputs or changed configuration fail validation before a comparison starts.

Each answer has independent progress, cancellation and failure recovery. Closing the comparison view does not cancel model calls; explicitly stop an answer or all answers. **Continue with this answer** creates an ordinary branch without modifying another answer. Earlier comparisons are saved and can be reopened. Usage appears only when reported by the provider; no exact price estimate or automatic winning-answer selection is supplied. Comparisons support API Chat only and do not relax the active-agent guard for shared coding checkouts.

## Project work and permissions

Add a project folder and explicitly trust it before starting workspace tools or a terminal. Inspect files, project-root instruction files, staged/unstaged changes and selected diffs. Providers may also apply their own user and parent-directory instructions. The terminal is a real user-controlled shell. Worktree tasks provide separate Git checkouts from an explicitly selected committed reference. Dirty source changes stay in the primary checkout. Archive preserves the checkout and branch; Restore makes an existing archived checkout available again. Nested project folders within one Git checkout share one active-agent guard; distinct worktrees can run independently.

Public mode availability follows the certification matrix. Known Windows Codex `0.158.0` has live read-only Ask/Plan/Review evidence and partial Code approval evidence. Unverified versions/providers expose their safe Ask path. **Code and Bypass remain unavailable by default** until complete write-mode certification; development testing can explicitly set `MULTICLIENT_DEVELOPMENT_MODES=1` before launching. Bypass uses native full-access controls and can act outside the selected folder. It is not a host sandbox.

Stopping a turn does not undo completed actions. Questions and approvals remain attached to a live turn; stale responses cannot grant permission. A runtime crash preserves committed output and marks unfinished work interrupted. Recovery never automatically replays a prompt or approval; review the partial result before resending.

## Save and protect your work

Conversation export offers readable Markdown, portable JSON with captured assets, and printable PDF. Markdown/PDF are readable exports; JSON is the format for importing a conversation with its context and attachments. Import creates new history and does not restore private CLI state.

Conversation JSON includes captured shared-source snapshots, portable tag names and referenced artifact history/assets. Import preserves those captured versions, without enabling global memory or repopulating another project's live knowledge library. Use a profile backup to preserve the complete knowledge, memory, tags, template, artifact and comparison libraries.

Restorable conversation JSON is limited to 64 MB, including embedded attachments, and 100,000 messages. Use a profile backup for larger histories, within the profile backup limit below.

Profile backup uses an online SQLite snapshot plus registered assets, with a 256 MB profile limit. Restore validates database/asset integrity before replacement, retains a rollback profile, and clears restored project trust. Backups and exports exclude the app's credential storage; your own message/attachment content is included and may contain anything you put there. Native CLI session files are separate and are not a portable part of the profile.

Restore disables CLI connections and clears their saved executable paths. Choose the installed CLI and enable its connection again in Settings, then explicitly trust any project you want to use. API connection settings remain, while keys already stored on this computer stay separate from the backup.

Local history and backup files are not encrypted. API keys use OS-backed secure storage where available, otherwise memory for the current app session. There is no application telemetry, automatic cloud synchronization or hosted Multiclient account.

**Settings → About → Export diagnostics** saves application/provider versions and bounded request timings/outcomes. It excludes prompt bodies, file paths and credentials; sending that file to another person remains your choice.

## Development and verification

Requires Node.js 24, npm and Git. Install provider CLIs separately when testing subscription connections.

```sh
npm ci
npm run dev
```

```sh
npm run typecheck
npm test
npm run test:storage
npm run test:history
npm run test:e2e
npm run probe
npm run pack
```

Unit and contract tests do not call paid providers. Storage/history harnesses run under Electron's Node ABI and include migration/restart checks, immutable history, corruption/rollback cases, and a measured 10,000-message fixture. Playwright uses an isolated profile and deterministic providers/local endpoints. `MULTICLIENT_PACKAGED_PATH` can point Playwright at an unpacked app executable. Linux desktop tests need Xvfb or an active display.

The complete source check passed typecheck, 232 unit/contract tests, all native integration/worker checks, and 42 desktop scenarios. The final Windows package passed every desktop scenario twice: 84 passes and two skips of the live Codex case, which remains unverified. Ten focused imports and five artifact workflows also passed, including CPU load during compression; the final portable launch/streaming/restart/exit check passed. An earlier package passed public-URL capture through the UI followed by local API submission. The rebuilt EXE is unsigned and its checksum is recorded in `release/SHA256SUMS.txt`. These checks do not establish live provider or Brave account certification. See [feature acceptance](features-acceptance.md), [implementation status](implementation-status.md) and the [import investigation](import-investigation.md) for evidence and causal limits.

Repeat the Windows packaged suite with fresh isolated profiles and no retries:

```powershell
$env:MULTICLIENT_PACKAGED_PATH = (Resolve-Path release/win-unpacked/Multiclient.exe).Path
npx playwright test --repeat-each=2 --retries=0
node scripts/test-portable.cjs
```

`npm run build` includes Windows runtime-supervisor compilation using the installed .NET Framework C# compiler. `npm run postinstall` rebuilds SQLite for Electron; do not substitute Node-ABI native builds. `npm run dist:win` creates `release/Multiclient.exe`. macOS/Linux need their own build, native dependency, lifecycle and package smoke tests; Windows success does not certify them.

## Release prerequisites

Before publishing a prerelease, run all deterministic checks and the packaged Windows smoke tests, review dependency notices, verify backup/restore with an existing profile, and record the exact supported provider versions. Finish the remaining live-account and permission certification before enabling public write modes. Signing credentials remain a separate prerequisite for a signed release; the present preview is unsigned.

The existing GitHub workflow produces Windows portable EXE artifacts and checksums. A matching `v` tag can publish a Release after CI checks; a hyphenated version creates a prerelease. CI never receives live provider accounts. Do not equate an artifact or green synthetic CI run with completed permission certification.

Use [the usability study](usability-study.md) to recruit and evaluate actual users. The repository supplies a protocol; it has not recruited testers or measured retention.

Multiclient is independent of OpenAI, Anthropic and Cursor. Application code is under the Elastic License 2.0; provider accounts/software retain their own terms. See [security](../SECURITY.md), [architecture](architecture/README.md), and [contributing](contributing/README.md).

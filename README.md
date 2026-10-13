<p align="center">
  <img src="resources/icon.png" width="88" alt="Multiclient logo" />
</p>

<h1 align="center">Multiclient</h1>

<p align="center">Your favorite AI tools. One space that feels like yours.</p>
<p align="center"><strong>Codex · Claude Code · Cursor · API chat · Local endpoints</strong></p>

---

A local-first Windows desktop app for everyday AI conversations and project work. Bring your official coding subscriptions, your API keys, or an existing local model server; keep your conversations together and make the workspace yours.

## At a glance

- **Find and organize your work** — search saved messages, pin, archive or tag chats, preserve drafts, and branch without overwriting the original. Reuse text from global or project prompt templates.
- **Everyday chat** — API and local-server connections, model discovery, supported images/PDFs and exports. Compare the same reviewed prompt across two or three API models, with separate cancellation and explicit additional usage.
- **Reusable project knowledge** — create chat projects without a folder, save instructions/notes, and select captured text or PDF extracts across related conversations. Source revisions stay visible and recoverable.
- **Web sources** — explicitly capture public HTTPS pages or search with your own Brave Search API key. Inspect saved source text and citations before sharing it; search results remain transient.
- **Editable outputs** — save documents and code as versioned artifacts, recover drafts, review proposed changes, and export. HTML/SVG previews are static and do not execute generated code.
- **Memory you control** — manually save, edit and select global or project notes. Sharing in new chats is opt-in; deleting a note preserves previously shared history.
- **Project work** — files, project instructions, Git changes, worktrees, and a built-in terminal. Editing modes require provider permission certification and remain a development opt-in.
- **Make it yours** — light and dark themes, image/GIF/video backgrounds, blur, and transparency.
- **Local by default** — saved conversations, attachment copies and settings on your computer, with profile backup and restore. No telemetry or cloud sync.

## Get started

**Windows x64 · Portable EXE · Unsigned preview**

Download **Multiclient.exe** from this repository’s **Releases** when available. Development builds are available under **Actions → Build and verify → Artifacts → Multiclient-Windows-x64**.

1. Put the EXE wherever you like and open it. No installer needed.
2. Open **Settings & connections**. Choose an API connection, an existing local server, or install and sign in to your preferred official CLI.
3. Choose a model and start a conversation. API Chat needs no project or CLI.
4. Use **Add project → Chat project** to group conversations and reusable knowledge without selecting a directory, or choose **Folder project** for files, Git and terminal work.
5. Open **Add context and tools** for project knowledge, Web sources, Memory, Prompt templates or Compare models. Review selected context before sending. **Save answer as document** keeps a completed response as an editable, versioned artifact.

Direct URL capture needs no search key; Brave search uses its own API key and credits. Model comparisons use two or three API targets and require an explicit send. See the [user guide](docs/guide.md) for source selection, artifact revisions and recovery.

Your chats, settings, and backgrounds stay on this computer when you move or replace the EXE. Windows may show a warning because the preview is unsigned.

> Unsigned development preview, not a certified public beta. Codex has partial live Windows coverage; Claude Code and Cursor still need live account validation. API payloads have deterministic tests, not paid-account certification. See [provider compatibility](docs/provider-compatibility/README.md).

## Development

Requires Node.js 24, npm, and Git.

```sh
npm ci
npm run dev
```

Verification: `npm run check`. The history acceptance harness includes a reproducible 10,000-message fixture: `npm run test:history`.

Build the Windows EXE with `npm run dist:win`. Output: `release/Multiclient.exe`.

[User guide & releases](docs/guide.md) · [Architecture](docs/architecture/README.md) · [Contributing](docs/contributing/README.md) · [Security](SECURITY.md)

---

[MIT license](LICENSE). Independent of OpenAI, Anthropic, and Cursor. Provider accounts and subscriptions are separate; their credentials remain managed by their official CLIs.

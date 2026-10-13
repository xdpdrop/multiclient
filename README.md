<p align="center">
  <img src="resources/icon.png" width="88" alt="Multiclient logo" />
</p>

# Multiclient

**Codex · Claude Code · Cursor · API chat · local model servers — one Windows workspace.**

Multiclient is a local-first Windows desktop app. It connects to OpenAI Codex, Claude Code, and Cursor through their official CLIs, plus API chat and compatible local endpoints (for example Ollama or LM Studio), and keeps everyday conversations and project work in one place. Chats, settings, and attachments stay on your computer; there is no telemetry or cloud sync.

## Features

- **Unified connections** — API keys, a compatible HTTPS or loopback endpoint, or an installed official CLI with its own sign-in flow.
- **Organize chats** — search, pin, archive, tag, drafts, and branch without overwriting the original thread.
- **Projects** — chat projects for grouped knowledge without a folder; folder projects for files, Git, worktrees, and a built-in terminal.
- **Context you choose** — project instructions and notes, manual memory, web page capture, prompt templates, and side-by-side model comparison (API targets).
- **Artifacts** — save answers as versioned documents or code, review changes, and export.
- **Appearance** — light and dark themes plus optional image, GIF, or video backgrounds.

Provider capabilities vary; some editing modes stay gated until certified. See the [user guide](docs/guide.md) and [provider compatibility](docs/provider-compatibility/README.md).

## Install

**Windows x64 · portable EXE · unsigned preview**

1. Download **Multiclient.exe** from [Releases](https://github.com/xdpdrop/multiclient/releases) when published, or from **Actions → Build and verify → Artifacts → Multiclient-Windows-x64** for development builds.
2. Place the EXE anywhere and run it. Your profile stays in `%APPDATA%/multiclient` on the same machine when you replace the file.
3. Windows may warn because the build is unsigned.

## Build from source

Requires Node.js 24, npm, and Git.

```sh
npm ci
npm run dev
```

- **Check (typecheck, unit tests, build, integration scripts, Playwright):** `npm run check`
- **Windows portable EXE:** `npm run dist:win` → `release/Multiclient.exe`

## Use

1. Open **Settings & connections** and enable API chat, a local server preset, or an official CLI (install and sign in through the CLI if needed).
2. Pick a model and start chatting. API chat does not require a project or CLI.
3. **Add project → Chat project** groups conversations and reusable knowledge; **Folder project** adds filesystem and terminal tools.
4. Use **Add context and tools** for knowledge, web sources, memory, templates, or compare models. Review selected context before sending.

More detail: [user guide](docs/guide.md) · [architecture](docs/architecture/README.md) · [contributing](docs/contributing/README.md) · [security](SECURITY.md)

## License

Multiclient application source is **source-available** under the [Elastic License 2.0](LICENSE) (licensor: **xdpdrop**). It is **not** OSI-approved open source. Releases tagged before this license change remain under the MIT License. Dependencies keep their own licenses ([third-party notices](THIRD_PARTY_NOTICES.md)).

Multiclient is independent of OpenAI, Anthropic, and Cursor. Provider accounts and subscriptions are separate; their credentials are managed by their official CLIs.

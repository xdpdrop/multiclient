<p align="center">
  <img src="resources/icon.png" width="88" alt="Multiclient logo" />
</p>

# Multiclient

Windows desktop app that runs Codex, Claude Code, and Cursor through their official CLIs, plus API chat and compatible local model servers (Ollama, LM Studio, and similar HTTPS or loopback endpoints).

Conversations, settings, and attachment copies stay on your machine under `%APPDATA%/multiclient`. There is no telemetry or cloud sync.

## Features

- Connect via API keys, a compatible endpoint, or an installed CLI with its own sign-in.
- Search, pin, archive, tag, and branch chats; drafts survive restarts.
- Chat projects group knowledge without a folder; folder projects add files, Git, worktrees, and a terminal.
- Attach project notes, memory, captured web pages, prompt templates, or compare two–three API models side by side.
- Save replies as versioned artifacts; export when you need to.
- Light/dark themes and optional image, GIF, or video backgrounds.

Not every provider supports every input or editing mode. Details are in the [user guide](docs/guide.md) and [provider compatibility](docs/provider-compatibility/README.md).

## Download

Windows x64 builds are published as a zip on [GitHub Releases](https://github.com/xdpdrop/multiclient/releases). Download `Multiclient-win-x64.zip` and `SHA256SUMS.txt` from the same release.

Verify the zip in PowerShell:

```powershell
Get-FileHash .\Multiclient-win-x64.zip -Algorithm SHA256
```

The `Hash` value should match the first field of `SHA256SUMS.txt`. Letter case does not matter.

## Install

Windows x64 zip.

1. Download from [Releases](https://github.com/xdpdrop/multiclient/releases), or from **Actions → Build and verify → Artifacts → Multiclient-Windows-x64** if you need a CI build.
2. Extract the zip and run `Multiclient.exe` from that folder. The profile stays in `%APPDATA%\multiclient`. Keep the extracted files together; the EXE needs the resources beside it.

## Build from source

Requires Node.js 24, npm, and Git.

```sh
npm ci
npm run dev
```

- `npm run check` — typecheck, unit tests, build, integration scripts, Playwright
- `npm run dist:win` — writes `release/Multiclient-win-x64.zip`

## Use

1. Open **Settings & connections** and enable API chat, a local server preset, or an official CLI.
2. Choose a model and chat. API chat does not need a project or CLI.
3. **Add project → Chat project** for grouped conversations; **Folder project** for filesystem and terminal tools.
4. **Add context and tools** covers knowledge, web sources, memory, templates, and model compare. Check what is selected before you send.

[user guide](docs/guide.md) · [architecture](docs/architecture/README.md) · [contributing](docs/contributing/README.md) · [security](SECURITY.md)

## License

Application source is [Elastic License 2.0](LICENSE) (licensor: xdpdrop). The repo is source-available and not OSI open source. Release tags made before this license change remain MIT. Dependency licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Multiclient is not from OpenAI, Anthropic, or Cursor. Subscriptions and API keys are yours; CLIs keep their own credentials.

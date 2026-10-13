# Third-party notices

Multiclient application code is MIT licensed. Dependencies retain the licenses distributed in their packages; the npm lockfile records the installed versions. Electron includes Chromium and Node.js notices in packaged distributions. React, xterm.js, node-pty, better-sqlite3, Zustand and the other packages retain their upstream copyrights.

PDF text extraction uses Mozilla PDF.js (`pdfjs-dist`), distributed under Apache License 2.0. Its license and matching worker are included with the packaged dependency; the release license inventory records its exact installed version.

OpenAI Codex, Anthropic Claude Code and Cursor are external tools, not bundled components of this application. Their trademarks identify the corresponding user-installed integrations. Their software licenses, subscription limits and service terms remain separate from Multiclient's license.

Provider images in `src/renderer/assets/providers` retain their owners' rights and are excluded from the MIT license for application code. They identify connections and do not imply endorsement. Original image contents are bundled locally; no provider image requests are made at runtime. Sources retrieved September 29, 2026:

- `codex.png`: OpenAI's installed Codex desktop distribution, version `26.924.2738.0`, `webview/assets/codex-app-ga-logo-3e5209898ca3.png` (unmodified product icon).
- `openai.png`: OpenAI's [official extension listing](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt), [published icon](https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.5917.62051/1790149959307/Microsoft.VisualStudio.Services.Icons.Default). See [OpenAI brand guidelines](https://openai.com/brand/).
- `claude.png`: [Claude's official website](https://claude.com), [published icon](https://assets.claude.com/95a868946ac8a31e5ff832e2899f294aa368b836.png?w=128&h=128).
- `cursor-light.svg` and `cursor-dark.svg`: Cursor's official [light](https://cursor.com/marketing-static/favicon-light.svg) and [dark](https://cursor.com/marketing-static/favicon.svg) icons. See [Cursor brand guidelines](https://cursor.com/brand).
- `anthropic.png`: [Anthropic's official website](https://www.anthropic.com), [published icon](https://cdn.prod.website-files.com/67ce28cfec624e2b733f8a52/67d31dd7aa394792257596c5_webclip.png).

Before distributing release artifacts, include the dependency license inventory generated from the release lockfile and verify the Electron license resources remain in the installer.

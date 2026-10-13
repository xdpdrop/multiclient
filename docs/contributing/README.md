# Contributing

Use Node.js 24 and the committed npm lockfile. Run `npm ci`, `npm run check`, and `npm run pack` before proposing a release. Formatting is handled by Prettier. Do not add credentials, local databases or raw provider transcripts to the repository.

Keep changes within their subsystem. Shared types cannot import Electron, adapters cannot import React, and only storage modules may execute SQL. Add normalized events and capabilities only when they represent real behavior; do not make every adapter pretend to support the same tools.

Tests use local fake providers unless explicitly marked as live. The test provider is selected only through the test launch environment. Never ship a UI control that sets the test environment or bypasses permission gates.

For native failures, rebuild against Electron's ABI with `npm run postinstall`. Use the supplied N-API PTY binaries where available rather than modifying dependency source or disabling compiler security features.

To release: review dependency licenses and current provider integration conditions, then follow the [version-tag procedure](../guide.md#github-builds-and-releases). After the OS matrix passes, GitHub Actions publishes the unsigned Windows portable EXE and its checksum. The packaging hook includes an inventory of runtime dependency licenses. Signing and macOS/Linux distribution remain later release work. Installed copies do not auto-update.

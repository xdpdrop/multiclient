# Multiclient verification map

This directory is the maintained source for verifying user-facing Multiclient behavior. Read this index, then follow one feature file.

## Baseline preconditions

- Node.js 24, dependencies from `npm ci`, and a finished `npm run build`.
- Linux drives run under `RUNNER_OS=Linux bash scripts/ci-step.sh`.
- Linux also requires `node_modules/electron/dist/chrome-sandbox` owned by root and mode `4755`.
- `node .cursor/skills/verify-multiclient/scripts/verify.mjs doctor` exits 0.
- Each drive gets a new `MULTICLIENT_TEST_DATA` directory. The send helper creates one itself.
- Never drive an Electron process you did not start for this run.

## Driving conventions

- Start from the welcome heading `What’s next?` unless the feature says otherwise.
- Prefer ARIA roles and accessible names.
- `Local test provider` is the offline provider used for proof. It is present only in test mode.
- Capture evidence with `webContents.capturePage()`, not Playwright `page.screenshot()`.
- Keep proof files in `/tmp/multiclient-verify-evidence/`. Cleanup deletes profiles, not that directory.

## Proof and skip reporting

- Show the user action and the resulting state.
- A sent message is proven by the user article text, not only by a screenshot.
- Record which feature file and entry point you drove.
- If an entry point cannot be reached, report the command and the unmet precondition. Do not mark it verified through a different path.

## Features

- [Send a message](./send-message.md) covers the composer, the local test provider, and draft retention.
- [Appearance](./appearance.md) covers theme changes from Settings.
- [Search history](./search-history.md) covers finding a saved message and opening it.

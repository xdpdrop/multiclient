---
name: verify-multiclient
description: 'Drive Multiclient, the local Electron desktop client, through its Playwright harness and prove a user-visible result. Use when asked to verify Multiclient, reproduce a desktop bug, or check that a build still sends a local message, changes appearance, or searches history.'
---

# Verify Multiclient

Multiclient is one Electron app (main, preload, renderer). There is no second package and no web server. Two instances can run together only when each has its own `MULTICLIENT_TEST_DATA` directory. Never point a verification run at a profile you did not create.

## Launch

From the repository root, with Node.js 24:

```sh
npm ci
npm run build
```

On Linux, the Electron sandbox must be root-owned and setuid, and the window manager must be Openbox under Xvfb. `scripts/ci-step.sh` starts that display when `RUNNER_OS=Linux`.

```sh
sandbox="node_modules/electron/dist/chrome-sandbox"
sudo chown root:root "$sandbox"
sudo chmod 4755 "$sandbox"
```

Ready means the built main process exists at `out/main/index.js` and `node .cursor/skills/verify-multiclient/scripts/verify.mjs doctor` exits 0. A passing doctor does not start the GUI.

Launch one isolated drive with:

```sh
RUNNER_OS=Linux bash scripts/ci-step.sh node .cursor/skills/verify-multiclient/scripts/verify.mjs send
```

On macOS or Windows, omit `RUNNER_OS=Linux bash scripts/ci-step.sh` and run the node command directly. The script creates a disposable profile, starts Electron, and deletes that profile on the way out.

The full repository gate, which this drive does not replace, is:

```sh
npm run check
```

`npm run verify` (typecheck, lint, unit tests, build) also requires Node 24; older Node is refused before those steps run.

Merge gates also run the CI run check after `npm run check`:
`node scripts/ci-run-check.mjs --repo <owner/name> --run <run-id> [--gate <file>] [--sha <hex>]`.
The head commit subject must not contain `[skip ci]` (earlier commits may). Gate reruns with `rerun-approval: <run-id> by Marek <YYYY-MM-DD>: "<quote>"`.
Only `success` conclusions pass; reruns need that line in `--gate`. CI verify runs Lint (`npm run lint` via `scripts/ci-step.sh`) before Typecheck.

## Doctor

```sh
node .cursor/skills/verify-multiclient/scripts/verify.mjs doctor
```

Doctor is read-only. It checks Node 24, `out/main/index.js`, the Electron binary, and on Linux the chrome-sandbox mode. It does not open a window or write a profile. Run it again whenever a drive fails before it reaches the heading `What’s next?`.

## Drive

Use accessible names from the feature map. The test provider is `Local test provider`. It appears only when `MULTICLIENT_TEST_MODE=1`, which the helper sets. Do not add a UI control that toggles that mode.

The helper drives one send. Appearance and history have exact Playwright commands in their feature files. Prefer those commands over clicking by coordinates.

Evidence screenshots must use `webContents.capturePage()`. Playwright `page.screenshot()` calls CDP `Page.captureScreenshot`, which fails intermittently on the Linux CI display even after the assertion has passed.

## Evidence

The helper writes proof to `/tmp/multiclient-verify-evidence/` and never deletes that directory:

- `send.json` records the draft text, the user message read back from the window, and the profile path that was removed
- `send.png` is the window after the user message is visible

A proof shows the action and the resulting message. The local test provider does not call a network model. Confirm the user article contains the typed text.

## Cleanup

The helper closes the Electron process it started and deletes only that run's `MULTICLIENT_TEST_DATA` directory. It does not kill processes by name. After cleanup, `/tmp/multiclient-verify-evidence/send.json` and `send.png` must still exist. If a run fails midway, close that app and remove that profile before starting another. Leave the evidence directory in place.

## Helpers

`node .cursor/skills/verify-multiclient/scripts/verify.mjs doctor`

`node .cursor/skills/verify-multiclient/scripts/verify.mjs send`

`send` accepts an optional evidence directory as its second argument. The default is `/tmp/multiclient-verify-evidence`.

Maintain the feature map with `/maintain-verification-skill` when these user paths change.

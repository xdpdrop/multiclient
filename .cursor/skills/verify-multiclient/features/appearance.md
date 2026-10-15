# Appearance

Appearance lets a user switch the workspace between light and dark from Settings and see that choice on the next launch of the same profile.

## Sub-features

- `appearance-open` opens Settings on the Appearance tab.
- `appearance-dark` sets the document theme to dark.
- `appearance-persist` keeps dark after the window restarts.

## How to get to it (user POV)

- Choose `Settings & connections` in the sidebar.
- Choose `Appearance`.
- Choose `Dark` or `Light`, then `Close dialog`.

## Driving it with verify.mjs

Preconditions:

- Doctor exits 0 and `npm run build` has produced `out/main/index.js`.
- Linux uses `scripts/ci-step.sh`.

- **Theme.** Run `RUNNER_OS=Linux bash scripts/ci-step.sh npx playwright test tests/e2e/appearance.spec.ts -g "theme persists" --retries=0`. The test exits 0.
- **Proof.** The test reaches `data-theme=dark` after restart. Its evidence screenshot is `test-results/conversation-dark.png`, written with `capturePage`.

## Gotchas

- A theme click that does not close the dialog still leaves the dialog open. Assert the theme attribute after `Close dialog`.
- Background media is a different path. Do not treat a dark theme pass as proof of video or GIF backgrounds.

# Send a message

Send a message lets a user choose the local test provider, type a draft, and see that draft as their own message without a network model call.

## Sub-features

- `send-provider` selects Local test provider from the Provider combobox.
- `send-draft` keeps typed text in the Message textbox until Send is used.
- `send-local` shows the typed text in a user message after Send.

## How to get to it (user POV)

- Open Multiclient to the welcome heading `What’s next?`.
- Choose the Provider combobox in the composer and pick `Local test provider`.
- Type in the Message textbox and press the Send message button.

## Driving it with verify.mjs

Preconditions:

- `node .cursor/skills/verify-multiclient/scripts/verify.mjs doctor` exits 0.
- No other verification profile is being driven.

- **Send.** Run `RUNNER_OS=Linux bash scripts/ci-step.sh node .cursor/skills/verify-multiclient/scripts/verify.mjs send`. The process exits 0.
- **Proof.** Read `/tmp/multiclient-verify-evidence/send.json`. `seen` equals `draft`, and `profileRemoved` is true. `send.png` is a non-empty PNG of the window after the user message is visible.

## Gotchas

- Enter in the custom model ID field confirms the model. It must not send the draft. Send uses the Send message button or Enter in the Message textbox.
- `page.screenshot()` can fail on the Linux CI display after the message is already visible. The helper uses `capturePage`.
- The local test provider does not prove a live Codex, Claude, or Cursor account.

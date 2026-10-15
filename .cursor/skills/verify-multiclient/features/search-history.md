# Search history

Search history lets a user find text in a saved conversation and open that conversation from the search dialog.

## Sub-features

- `history-save` keeps a sent local message in the conversation list.
- `history-search` finds that message from Search conversations.
- `history-open` shows the matched message in the conversation.

## How to get to it (user POV)

- Send a message with Local test provider.
- Choose `Search conversations` in the sidebar.
- Type a word that appears only in that message and open the result.

## Driving it with verify.mjs

Preconditions:

- Doctor exits 0 and the production build exists.
- Linux uses `scripts/ci-step.sh`.

- **Search.** Run `RUNNER_OS=Linux bash scripts/ci-step.sh npx playwright test tests/e2e/history.spec.ts -g "message-content search" --retries=0`. The test exits 0.
- **Proof.** The test shows the saved needle in the reopened conversation. Its evidence screenshot is `test-results/history-search.png`.

## Gotchas

- Search matches stored message text. A draft that was never sent is not a history result.
- The archived-history half of the same test is a separate entry point. A search pass does not prove archive restore.

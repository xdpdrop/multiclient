# Tests (`tests/`)

| Path                  | Role                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `unit/`, `contracts/` | Vitest; default `npm test` (`vitest run`, 10s timeout, max 2 workers).                                |
| `integration/`        | Harnesses built by electron-vite; run via `scripts/test-*.cjs` after `npm run build`.                 |
| `e2e/`                | Playwright against the Electron app (`npm run test:e2e` = build + playwright, 1 worker, 60s timeout). |
| `live/`               | Opt-in live provider tests (`vitest.live.config.ts`). Not part of `npm test` or CI.                   |

Use local fake providers only. The test provider is selected via launch environment (`MULTICLIENT_TEST_MODE`, `MULTICLIENT_TEST_DATA`). Do not add UI that sets those variables or bypasses permission gates.

Single-file example: `npx vitest run tests/unit/secrets.test.ts`.

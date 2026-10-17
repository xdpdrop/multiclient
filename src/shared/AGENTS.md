# Shared contracts (`src/shared`)

Zod schemas and types (`schema.ts`, `types.ts`, `defaults.ts`, feature modules). No Electron, no React, no SQL.

IPC public routes are defined here (`routes[route].parse` in `schema.ts`). Adding a feature extends the named contract, the runtime dispatch, and a preload method together. Schemas are usually `.strict()`.

`src/shared` cannot import Electron. Provider adapters cannot import React.

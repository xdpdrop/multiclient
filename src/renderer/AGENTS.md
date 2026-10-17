# Renderer (`src/renderer`)

Sandboxed React + Zustand UI (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`). Entry: `src/main.tsx`, `App.tsx`. No Node and no direct IPC — only `window.desktop` from preload.

Layout: `features/`, `components/`, `appearance/` (`global.css`, `Background.tsx`), `state.ts`, `App.module.css`.

`artifact-diagram.ts` is a separate restricted diagram preview window (bundled to `out/main/artifact-diagram.js`): no Node, scripts, navigation, or network.

## Brand and UX (no-go unless tasked)

Product name, voice, theme, and layout are intentional. Do not restyle, rename, or swap copy on unrelated work.

- Provider marks: `assets/providers/` (third-party; see `THIRD_PARTY_NOTICES.md`).
- Theme settings: `appearanceSchema` in `src/shared/schema.ts`. Themes are validated JSON — not executable CSS or JS.
- Usage UI: `components/ConnectionUsage.tsx` (see `src/runtime/AGENTS.md` for usage reporting rules).

Accessibility (keyboard order, contrast, 800×600 at 200% zoom) is enforced in `tests/e2e/accessibility.spec.ts`; do not loosen those checks for layout tweaks.

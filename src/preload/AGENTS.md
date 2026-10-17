# Preload (`src/preload`)

`contextBridge.exposeInMainWorld('desktop', api)` is the renderer's only privileged surface. Feature factories live in `features/`; each adds named methods the same way.

Calls use `ipcRenderer.invoke('multiclient:' + route, input)` and listen only on `multiclient:event`. New capabilities need a matching Zod route in `src/shared`, a runtime handler, and a preload factory — not a raw `ipcRenderer` or free-form channel in the page.

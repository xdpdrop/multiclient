# Main process (`src/main`)

Electron main process: browser window, privileged IPC, OS dialogs, `safeStorage` credentials, `app://` and `media://` protocols, exports, backup/restore, artifact preview windows.

Key modules: `index.ts` (`trustedSender` for invoke origin), `runtime.ts` (`RuntimeHost` — starts the utility process, forwards events, requests secrets from main), `supervisor.ts` (non-Windows process-group cleanup), `secrets.ts`, `artifacts.ts`, `history.ts`, `media.ts`, `clipboard.ts`, `native/`.

`RuntimeHost` enrolls the runtime in the C# supervisor on Windows before provider work. A fatal runtime exit rejects pending calls, closes owned provider processes, and attempts one automatic recovery. Nothing replays a prompt, research request, command, or approval.

## C# supervisor (Windows only)

`native/RuntimeSupervisor.cs` is the only C# source. `scripts/build-supervisor.cjs` compiles it with .NET Framework `csc.exe` only on `win32`. Output: `out/main/runtime-supervisor.exe`; `electron-builder.yml` copies it into Windows package resources.

`WindowsJobSupervisor.attach(pid)` spawns the exe with the runtime pid, creates a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assigns the process, prints `READY`, and blocks on stdin. Closing stdin or killing the helper terminates the runtime and descendants. Not built or used on Linux or macOS.

## IPC (main side)

Packaged renderer origin is `app://client`; development uses `ELECTRON_RENDERER_URL`. Invokes are accepted only from the main window's main frame.

Routes in `publicRoutes` are forwarded via `RuntimeHost.request`. Dialogs, credentials, backup, theme, and external URLs use dedicated `multiclient:*` handlers in main and do not use the public route table.

Credential bytes stay in main. The runtime sends `{ type: 'secret', requestId, providerId }`; main returns the value. The runtime does not read the credential directory.

## Credential storage (no-go unless tasked)

`secrets.ts` stores API and Brave Search keys with Electron `safeStorage` when a real OS backend exists. On Linux `basic_text`, keys stay in process memory only. Files live under `userData/credentials` (temp file, mode `0o600`, then rename). CLI subscription credentials belong to official CLIs and are rejected by `Secrets.set`.

Also off limits unless explicit: `multiclient:saveCredential`, `multiclient:webSaveCredential`, `multiclient:login`, the runtime `secret` request/response, and any path copying secrets into SQLite, exports, backups, diagnostics, or child environments.

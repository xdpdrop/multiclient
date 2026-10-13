# Packaged import investigation — October 13, 2026

The investigation demonstrates a native swallowed-click mechanism in the former initial loading state and verifies that the current guard prevents it under identical controlled scheduling. It does **not** establish that this mechanism caused the earlier isolated package-suite failure: that run did not retain picker or renderer input records.

## Original evidence

The earlier full packaged run had 40 desktop passes, one skipped live case and one failure. The 10,000-message import test clicked Import conversation JSON, then waited 30 seconds for the archive dialog to close. The final snapshot showed an open, idle dialog with enabled actions and no visible alert. The trace contained Playwright test-runner steps, without Electron browser input snapshots or native picker counters. A completed Playwright click alone cannot distinguish a dispatched application handler from a mouse release that no longer produces a click.

Original artifacts: `.cache/packaged-results/performance-10-000-message-9395b--while-a-local-turn-streams/{trace.zip,error-context.md}`.

## Packaged controls before the query/action ownership correction

The package available before the subsequent query/action ownership correction ran the unchanged `tests/e2e/performance.spec.ts` workflow five times serially with fresh profiles. All five passed; import/render took 1,671–3,490 ms. Another five runs used 12 CPU worker threads on the 16-logical-processor test machine. All five passed; import/render took 1,870–3,641 ms. The latter copy preserved every original workflow assertion and timeout and retained browser traces on success as well as failure. Each showed enabled pointerdown, pointerup and click, followed by exactly one native picker call.

This is repeated reliability evidence, not causal proof for the original failure. There were no automatic retries or timeout increases. Package building was idle during these controlled runs.

- Baseline command/output: `.cache/import-investigation/baseline.log`.
- CPU helper/output: `.cache/import-investigation/cpu-load.cjs`, `cpu-load.log`.
- Observed test/config: `performance-observed.spec.ts`, `playwright.config.cjs`.
- Browser traces: `.cache/import-investigation/cpu-load/**/import-success-browser-trace.zip`.

## Isolated native-pointer comparison

The preserved helper `.cache/import-investigation/causal-pointer.cjs` launches a disposable extracted copy of the current package with the existing Electron runtime. Its native bindings, supervisor and migrations are present. Both variants use the same launch topology, environment and 10,000-message file. The sole behavioral difference between each matched pair is the HistoryBrowser busy initializer: former `false` versus current `true`. Normal scheduling controls imported successfully in both variants.

For the scheduling experiment, both variants receive the same interventions: the existing passive-effect body starts after 500 ms, its archive response starts after an additional 600 ms, and Playwright holds a real native pointer press for 700 ms. These interventions expose the first-render/loading transition; they are not a measurement of naturally occurring effect latency in the original run. The helper never sets the DOM's disabled property, dispatches synthetic pointer events, fakes import success, or changes the importer. The application effect itself sets busy and React updates disabled.

| Variant                                                 | Native sequence                                                    | Picker calls | Outcome                               |
| ------------------------------------------------------- | ------------------------------------------------------------------ | ------------ | ------------------------------------- |
| Former initial `false`, normal scheduling               | Down → up → click, all enabled                                     | 1            | Imported and closed                   |
| Current initial `true`, normal scheduling               | Down → up → click, all enabled                                     | 1            | Imported and closed                   |
| Former initial `false`, controlled scheduling           | Down while enabled → effect disables → up while disabled; no click | 0            | Idle open archive, zero conversations |
| Current initial `true`, identical controlled scheduling | Loading completes first; down → up → click, all enabled            | 1            | Imported and closed                   |

The renderer records native event `isTrusted` to distinguish these input events from script-dispatched events. The controlled experiment proves that the old enabled-to-disabled transition can swallow a physical click, and that initializing loading state before the first render removes that transition. The natural timing of the original failure remains unknown.

Matched JSON and browser traces are retained as `.cache/import-investigation/{legacy-normal,fixed-normal,legacy-delayed,fixed-delayed}.{json,zip}`. The extraction helper and mutation record are `extract-legacy.cjs` and `legacy-extraction.json`. No shared package, build output or production source was modified by this investigation.

## Confirmed fixes and regressions

The component audit reproduced two further loading-state defects and fixed them in `HistoryBrowser.tsx`:

- Entering Archive from a completed Search query inserted enabled action buttons before the passive effect disabled them. A DOM-commit regression observed `disabled=false` before the fix and `disabled=true` afterward. Changing tabs now sets query loading in the same update as the tab; clicking the already selected tab remains a no-op.
- A completed query could clear the shared loading flag while an import or backup was still pending. Deferred-operation regressions failed before the fix. Query and action loading now have separate ownership, and actions stay disabled until both finish.

All eight focused component regressions pass, including the first-render guard, deferred initial query, both pending operations, same-tab behavior and visible failures/retry. The native desktop regression in `tests/e2e/import.spec.ts` also passed: cancellation leaves the dialog idle without a chat or error, invalid JSON shows an error inside the dialog, and one explicit valid retry selects imported history that survives restart without inference. These results establish the corrected behaviors independently of historical attribution.

The runtime audit found no silent native success path: cancellation returns `null`, failures reject, and a successful import returns the conversation after persistence. The original test contains no assets. A separate asset-bearing failure limitation remains: registration checks during cleanup can wait for additional runtime timeouts when the runtime is unresponsive. That limitation cannot explain the original asset-free failure and was not changed in this focused patch.

## Broader verification findings

The first follow-up complete source check passed all 229 unit/contract tests and native harnesses, but its desktop run ended with 39 passes, one live skip and three failures while packaging and a separate 12-worker stress batch overlapped. The original 10,000-message import scenario passed. The failed scenarios and traces are preserved under `.cache/import-investigation/source-failures`, with the complete output in `source-check.log`; they are not counted as a successful gate.

The worktree failure exposed an independent fixture race: clicking Choose folder did not await its asynchronous project creation before reading the new project's ID. The fixture now waits for successful chooser closure, with the existing assertion deadline, before querying the snapshot. The focused worktree and terminal scenarios subsequently both passed. A separate native PowerShell probe reached its prompt in 1.17 seconds; its earlier five-second prompt failure under combined load is consistent with startup delay, without proof of a persistent terminal defect. No terminal deadline was increased.

The diagram failure rejected a two-node graph through the original five-second watchdog. A native loaded probe reproduced that watchdog firing at 5,016 ms before `loadFile` finished, which happened at 15,438 ms; Mermaid had not begun rendering. Subsequent windows loaded in 495–564 ms and rendered in 452–504 ms. Reversing background-throttling settings did not reproduce a systematic difference, and this Mermaid version uses microtasks for measurement. Throttling was therefore rejected as a cause. This isolates a cold initialization stall, without claiming to distinguish process startup from parsing the bundled renderer. Evidence is retained under `.cache/diagram-investigation`.

The correction separates a bounded 30-second renderer initialization phase from the unchanged five-second execution budget for user-supplied diagrams, with distinct startup and rendering errors. Neither desktop test deadlines nor retry policies change. Five exact packaged artifact workflows had already passed under CPU load plus portable compression; those earlier passes do not substitute for verification of the corrected build.

## Final verification

- Complete final `npm run check`: typecheck, 232 unit/contract tests across 43 files, all native integration/worker harnesses, 42 desktop passes and one live Codex skip. Desktop duration: 4.3 minutes. Output: `.cache/import-investigation/source-final-check.log`.
- Rebuilt package: main, renderer and diagram bundle bytes match `out`; ASAR SHA-256 is `af50298825bed426ac374ecf2f51af10e7fda95c9e10391bffced34dadc88bdb`, unchanged after stress. Evidence: `final-package.json` and `final-focused-summary.json` under `.cache/import-investigation`.
- Ten final focused imports passed: five without synthetic CPU load during portable compression (1,755–2,926 ms import/render), five with twelve CPU workers plus compression (4,275–8,043 ms). Each recorded one enabled native click and exactly one picker call. Five exact final artifact workflows also passed with twelve workers plus compression. All load helpers exited; `final-load-cleanup.json` records zero active helpers.
- Full packaged desktop suite: `MULTICLIENT_PACKAGED_PATH` with `--repeat-each=2 --retries=0`, fresh profile for every scenario, 84 passes and two skips of the live Codex case in 9.4 minutes. Compression and synthetic load had ended before this run. Output: `.cache/import-investigation/package-final-full.log`.
- Final portable EXE passed launch, streaming, saved-history restart and clean exit. Output: `.cache/import-investigation/portable-final.log`. The 150,783,494-byte portable EXE is unsigned; SHA-256 `e064c5acdb464d31dde0c7693601d3872e123025eaac24d8c44077645b98a7b8` is recorded in `release/SHA256SUMS.txt`. This differs from the unpacked executable hash in the focused package manifest.

All final checks used zero retries. Test deadlines were unchanged; only the measured diagram initialization phase gained its own bounded startup allowance. Live Codex/account certification remains unverified. The repeated results support the corrected package's reliability on this Windows machine without claiming proof of the original failure's exact cause.

## Recurrence diagnostics

The permanent performance test already records bounded pointerdown/up/click and disabled transitions with epoch timestamps, native picker invocation timestamps, dialog state, and local/background alert text; failure retains an actual Electron browser trace. Those stages distinguish a swallowed click (no click/picker) from an invoked import whose later stage failed (picker present). Diagnostic collection failure preserves the original assertion error, local paths are redacted, and credentials/import contents are not logged.

If a future failure has a picker invocation but no useful error, the smallest further diagnostic is the existing named diagnostics export's bounded runtime request outcomes/durations for `importData`, `snapshot` and `conversation`, plus a picker-return timestamp. That would separate parsing/validation before runtime dispatch, persistence and transcript selection. Avoid private IPC handler hooks in permanent tests. The initial loading guard, independently reproduced local dialog error visibility fix, and any separately identified query/action ownership fix must be reported on their own evidence; none retrospectively establishes the original failure's cause.

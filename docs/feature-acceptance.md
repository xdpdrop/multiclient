# Six-feature acceptance coverage

This record separates deterministic implementation evidence from live service certification and human usability evidence. A passing local mock does not certify a paid provider, search subscription, or public release.

On October 13, 2026, the final-source `npm run check` passed: typecheck, 226 unit/contract tests across 42 files, all native integration/compiled-worker checks, and 41 desktop scenarios. This includes the archive-dialog feedback/readiness change and permanent import diagnostics. The rebuilt Windows unpacked package then passed all 41 desktop scenarios in 5.9 minutes. One live Codex scenario was skipped in each run and remains unverified. Tests use no automatic retries. The final portable launcher passed launch, streaming, persistence, restart and exit checks; the public-web smoke also passed against the final package. See the [full acceptance checklist](features-acceptance.md) for the unsigned executable checksum and measurements.

An earlier packaged run had one import failure during concurrent compression; its cause remains unproven. The archive action-error visibility defect was independently reproduced and corrected. Instrumented focused runs passed without proving the original issue fixed; the final complete source and rebuilt-package suites subsequently passed. The performance test now attaches a real Electron browser trace and bounded picker/input/disabled/background-alert diagnostics on import failure, without changing timeouts or logging credentials/import payloads.

## Cross-feature storage and recovery

Run `npm run test:features` after building the current source. The Electron/SQLite harness in `tests/integration/features.ts` covers:

- Upgrading a populated schema-4 profile while preserving message and workspace identities; rollback after an intentionally failed additive migration.
- Folderless chat projects without synthetic workspaces and refusal to create coding workspaces for chat projects.
- Project instructions/documents, manual memory defaults/scope checks, and captured web sources retaining immutable content after library edits and deletion.
- Artifact revision conflicts, draft conflicts, revision forks, pinned branch references, and portable export excluding later artifact revisions.
- Comparison child history/context snapshots and interruption recovery without replaying untouched drafts.
- Conversation export/import with referenced assets, pending context snapshots, selected history IDs, and unsent artifact references.
- Populated WAL profile backup/restore retaining feature tables, editor drafts, comparison results, templates, source snapshots, and assets while keeping credentials separate.
- Staged restore rejection for missing context tables, malformed snapshots, invalid artifact heads, and unsupported future schema versions without replacing current history.

This harness verifies storage behavior. It does not replace renderer or real provider-payload tests.

The physical source-file lifetime boundary is covered separately in `tests/unit/attachments.test.ts`: real PNG/PDF files are imported, the originals are deleted, and the retained asset bytes and extracted page text are checked.

## Compiled desktop workflows

Run `npx playwright test tests/e2e/features.spec.ts --workers=1` after building. These scenarios interact with the compiled Electron client; API scenarios use a disposable keyless loopback mock and do not incur paid usage.

| Workflow                       | Assertions                                                                                                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everyday project and knowledge | Create a chat project through the UI; save and share instructions/notes; captured API payload contains each source once; selecting no historical messages retains pinned instructions while excluding the historical document; restart preserves the transcript. |
| Manual memory                  | Create a note with automatic inclusion initially off; explicitly share it; captured API request includes it once; deleting and starting fresh excludes it while retaining the old immutable transcript snapshot.                                                 |
| Editable artifact              | Save a completed answer as an artifact, create an immutable revision, recover an unfinished editor draft after restart, and retain prior revisions.                                                                                                              |
| Comparison                     | Explicitly send identical reviewed context to two models; retain a successful lane beside a quota failure; continue from the successful lane as a branch; restart preserves results without another request.                                                     |
| Portable source history        | Native JSON import/export remaps source UUIDs, citation text/block/audit tokens, artifact/revision IDs, and local asset URLs while preserving captured content and asset bytes; tags survive.                                                                    |

The additional narrow keyboard scenario reaches the context chooser and memory library at an 800×600 window and 200% zoom, keeps the focused control in the viewport, and retains the unsent draft without inference.

Feature owners also maintain focused research transport/parser tests, isolated artifact preview tests, comparison cancellation/preflight tests, organization UI tests, and context/coordinator payload tests. The complete check must run against one stable build after integration; concurrent Playwright commands need separate output directories.

The instruction revision workflows have their own `tests/e2e/instructions.spec.ts` coverage. The artifact suite also passed the complete Ask to revise → captured API input → review → explicit revision acceptance workflow.

Automated web coverage combines transport, handler, component, worker and persistence checks. A separate compiled-Electron smoke, repeated successfully against the final Windows package, captured the public RFC 9110 text through the UI, sent all 196 captured paragraphs and citation markers to exactly one keyless local API request, and preserved its immutable source and citation audit after restart without replay. This used no search key or paid inference and recorded zero errors. See the [full acceptance checklist](features-acceptance.md) for the requirement mapping and remaining external release evidence.

## Remaining external evidence

These checks cannot establish live Brave account compatibility, paid provider/model/version certification, packaged-app signing, or the planned twelve-person usability outcome. Record those results separately; do not infer them from mocks or skipped tests. Existing execution-mode certification and no-telemetry defaults remain release constraints.

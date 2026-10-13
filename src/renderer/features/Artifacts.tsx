import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import type {
  Artifact,
  ArtifactKind,
  ArtifactReference,
  ArtifactView,
  ArtifactsApi,
} from '../../shared/artifacts';

const api = () => window.desktop as typeof window.desktop & ArtifactsApi;
const kinds: ArtifactKind[] = ['markdown', 'code', 'text', 'html', 'svg', 'mermaid'];
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
type ArtifactTab = 'source' | 'preview';
export function artifactTabForKey(tab: ArtifactTab, key: string): ArtifactTab | undefined {
  if (key === 'Home') return 'source';
  if (key === 'End') return 'preview';
  if (key === 'ArrowLeft' || key === 'ArrowRight') return tab === 'source' ? 'preview' : 'source';
}
export function revisionAfterKey(
  revisions: readonly { id: string }[],
  currentId: string,
  key: string,
) {
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return undefined;
  const index = revisions.findIndex((revision) => revision.id === currentId);
  if (index < 0) return undefined;
  return revisions[index + (key === 'ArrowDown' ? 1 : -1)]?.id;
}
export function ArtifactEditorTabs({
  tab,
  onChange,
  id,
}: {
  tab: ArtifactTab;
  onChange: (tab: ArtifactTab) => void;
  id: string;
}) {
  const [focused, setFocused] = useState<ArtifactTab>(tab);
  const buttons = useRef<Partial<Record<ArtifactTab, HTMLButtonElement | null>>>({});
  useEffect(() => setFocused(tab), [tab]);
  return (
    <div className="row" role="tablist" aria-label="Artifact editor views">
      {(['source', 'preview'] as const).map((name) => (
        <button
          key={name}
          ref={(node) => {
            buttons.current[name] = node;
          }}
          className={`button ${tab === name ? 'primary' : ''}`}
          type="button"
          role="tab"
          id={`${id}-${name}-tab`}
          aria-controls={`${id}-${name}-panel`}
          aria-selected={tab === name}
          tabIndex={focused === name ? 0 : -1}
          onClick={() => onChange(name)}
          onKeyDown={(event) => {
            const next = artifactTabForKey(name, event.key);
            if (next) {
              event.preventDefault();
              setFocused(next);
              buttons.current[next]?.focus();
            }
          }}
        >
          {name === 'source' ? 'Source' : 'Preview'}
        </button>
      ))}
    </div>
  );
}
export function suggestedArtifactKind(language?: string): ArtifactKind {
  if (language === 'md' || language === 'markdown') return 'markdown';
  if (language === 'html' || language === 'svg' || language === 'mermaid') return language;
  return language ? 'code' : 'text';
}

export function SaveArtifactButton({
  source,
  kind,
  language = '',
  conversationId,
  messageId,
  projectId,
  onSaved,
  label = 'Save as artifact',
}: {
  source: string;
  kind?: ArtifactKind;
  language?: string;
  conversationId?: string;
  messageId?: string;
  projectId?: string | null;
  onSaved?: (view: ArtifactView) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false),
    [title, setTitle] = useState('Untitled artifact'),
    [format, setFormat] = useState<ArtifactKind>(kind ?? suggestedArtifactKind(language));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <button className="textButton" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <Dialog title="Save artifact" onClose={() => setOpen(false)}>
          <div className="dialogBody">
            <label>
              Title
              <input
                aria-label="Artifact title"
                maxLength={150}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Format
              <select
                aria-label="Artifact format"
                value={format}
                onChange={(e) => setFormat(e.target.value as ArtifactKind)}
              >
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <p className="muted small">
              Save an editable copy. HTML and SVG previews are static; code is never executed.
            </p>
            {error && <p role="alert">{error}</p>}
            <button
              className="button primary"
              disabled={busy || !title.trim()}
              onClick={() => {
                setBusy(true);
                setError('');
                void api()
                  .artifactCreate({
                    title,
                    kind: format,
                    language:
                      format === 'code'
                        ? language.replace(/[^a-zA-Z0-9_+.#-]/g, '').slice(0, 40)
                        : '',
                    source,
                    projectId,
                    originConversationId: conversationId,
                    originMessageId: messageId,
                  })
                  .then((view) => {
                    setOpen(false);
                    onSaved?.(view);
                  })
                  .catch((e) => setError(errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Save artifact
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

type Proposal = {
  artifactId: string;
  baseRevisionId: string;
  source: string;
  sourceMessageId: string;
};
export function Artifacts({
  projectId,
  onClose,
  onAskToRevise,
  initialArtifactId,
  initialRevisionId,
  proposal,
  onAttach,
  forkOnEdit = false,
}: {
  projectId?: string | null;
  onClose: () => void;
  onAskToRevise: (
    reference: ArtifactReference & { title: string; kind: ArtifactKind; source: string },
  ) => void;
  initialArtifactId?: string;
  initialRevisionId?: string;
  proposal?: Proposal;
  onAttach?: (reference: ArtifactReference) => void;
  forkOnEdit?: boolean;
}) {
  const [items, setItems] = useState<Artifact[]>([]),
    [selected, setSelected] = useState(initialArtifactId ?? proposal?.artifactId ?? '');
  const [view, setView] = useState<ArtifactView>(),
    [source, setSource] = useState(''),
    [base, setBase] = useState(''),
    [revisionId, setRevisionId] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [compare, setCompare] = useState(!!proposal);
  const [newTitle, setNewTitle] = useState(''),
    [newKind, setNewKind] = useState<ArtifactKind>('markdown');
  const [tab, setTab] = useState<ArtifactTab>('source'),
    [previewSerial, setPreviewSerial] = useState(0),
    [previewStatus, setPreviewStatus] = useState<{
      status: 'opening' | 'opened' | 'error';
      message: string;
    }>();
  const tabId = useId();
  const generation = useRef(0),
    sourceRef = useRef(''),
    baseRef = useRef(''),
    proposalMessage = useRef<string | undefined>(undefined),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve()),
    editingId = useRef(''),
    conflict = useRef(false),
    dirty = useRef(false);
  const protectedBranch = forkOnEdit && selected === (initialArtifactId ?? proposal?.artifactId);
  const protectedBranchRef = useRef(protectedBranch);
  protectedBranchRef.current = protectedBranch;
  const refreshList = () => api().artifactsList(projectId).then(setItems);
  useEffect(() => {
    void refreshList().catch((e) => setError(errorText(e)));
  }, [projectId]);
  function setEditor(next: ArtifactView, selectedRevision?: string) {
    const draft = selectedRevision ? null : next.draft;
    const revision = next.revisions.find(
      (r) => r.id === (selectedRevision ?? next.artifact.headRevisionId),
    )!;
    const text = draft?.source ?? revision.source,
      baseId = draft?.baseRevisionId ?? revision.id;
    generation.current = next.draft?.generation ?? 0;
    sourceRef.current = text;
    baseRef.current = baseId;
    proposalMessage.current = draft?.sourceMessageId ?? undefined;
    dirty.current = false;
    setSource(text);
    setBase(baseId);
    setRevisionId(revision.id);
    setView(next);
    conflict.current = false;
    setNotice(draft ? 'Recovered saved draft.' : 'Saved revision.');
  }
  function saveDraft(id = editingId.current) {
    const text = sourceRef.current,
      baseId = baseRef.current,
      sourceMessageId = proposalMessage.current;
    queue.current = queue.current
      .then(async () => {
        if (!id || !dirty.current || conflict.current || protectedBranchRef.current) return;
        const result = await api().artifactSaveDraft({
          id,
          baseRevisionId: baseId,
          source: text,
          expectedGeneration: generation.current,
          sourceMessageId,
        });
        if (editingId.current !== id) return;
        if (!result.ok) {
          conflict.current = true;
          setError(
            'Another editor saved this draft. Your source is preserved here; compare before continuing.',
          );
          setView(result.view);
          setCompare(true);
          return;
        }
        generation.current = result.view.draft!.generation;
        setView(result.view);
        setNotice('Draft saved.');
        if (sourceRef.current === text && baseRef.current === baseId) dirty.current = false;
      })
      .catch((e) => {
        if (editingId.current === id) setError(errorText(e));
      });
    return queue.current;
  }
  useEffect(() => {
    let active = true;
    clearTimeout(timer.current);
    editingId.current = selected;
    setTab('source');
    setPreviewStatus(undefined);
    setError('');
    setView(undefined);
    if (selected)
      void queue.current
        .then(() => api().artifactRead(selected))
        .then((next) => {
          if (!active) return;
          setEditor(next, selected === initialArtifactId ? initialRevisionId : undefined);
          if (proposal?.artifactId === selected) {
            sourceRef.current = proposal.source;
            baseRef.current = proposal.baseRevisionId;
            proposalMessage.current = proposal.sourceMessageId;
            setSource(proposal.source);
            setBase(proposal.baseRevisionId);
            setCompare(true);
            dirty.current = !protectedBranchRef.current;
            if (dirty.current) void saveDraft(selected);
          }
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    return () => {
      active = false;
      clearTimeout(timer.current);
    };
  }, [selected]);
  useEffect(() => {
    if (tab !== 'preview' || !view || view.artifact.id !== selected || !revisionId) return;
    let active = true;
    setPreviewStatus({
      status: 'opening',
      message: 'Opening the saved revision in an isolated preview window…',
    });
    void api()
      .artifactPreview({ id: selected, revisionId })
      .then(() => {
        if (active)
          setPreviewStatus({
            status: 'opened',
            message: 'Opened the saved revision in a separate sandboxed window.',
          });
      })
      .catch((e) => {
        if (active) setPreviewStatus({ status: 'error', message: errorText(e) });
      });
    return () => {
      active = false;
    };
  }, [tab, selected, revisionId, previewSerial]);
  const close = () => {
    clearTimeout(timer.current);
    setBusy(true);
    void saveDraft()
      .then(() => {
        if (dirty.current || conflict.current) {
          setError(
            'Your draft has not been saved. Resolve the conflict or save a separate artifact before closing.',
          );
          return;
        }
        onClose();
      })
      .finally(() => setBusy(false));
  };
  const current = view?.revisions.find((r) => r.id === revisionId),
    previous = view?.revisions.find((r) => r.id === base),
    stale = !!view && base !== view.artifact.headRevisionId;
  return (
    <Dialog title="Artifacts" wide onClose={close}>
      <div className="dialogBody">
        <div className="row">
          <select
            aria-label="Choose artifact"
            value={selected}
            onChange={(e) => {
              const nextId = e.target.value;
              clearTimeout(timer.current);
              void saveDraft().then(() => {
                if (dirty.current || conflict.current) {
                  setError('Save or fork this draft before switching artifacts.');
                  return;
                }
                setSelected(nextId);
              });
            }}
          >
            <option value="">Choose an artifact…</option>
            {items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} · {a.kind}
              </option>
            ))}
          </select>
          <button
            className="button"
            onClick={() => {
              void refreshList().catch((e) => setError(errorText(e)));
            }}
          >
            Refresh
          </button>
          <button
            className="button"
            onClick={() => {
              setBusy(true);
              void api()
                .artifactImport()
                .then(async (next) => {
                  await refreshList();
                  if (next) setSelected(next.artifact.id);
                })
                .catch((e) => setError(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            Import artifact JSON
          </button>
        </div>
        {!selected && (
          <>
            <label>
              New artifact title
              <input
                aria-label="New artifact title"
                value={newTitle}
                maxLength={150}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </label>
            <select
              aria-label="New artifact format"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as ArtifactKind)}
            >
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <button
              className="button primary"
              disabled={busy || !newTitle.trim()}
              onClick={() => {
                setBusy(true);
                void api()
                  .artifactCreate({ title: newTitle, kind: newKind, source: '', projectId })
                  .then(async (next) => {
                    await refreshList();
                    setSelected(next.artifact.id);
                  })
                  .catch((e) => setError(errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Create artifact
            </button>
          </>
        )}
        {view && (
          <>
            <h3>{view.artifact.title}</h3>
            <div className="row">
              <label>
                Inspect revision
                <select
                  aria-label="Artifact revision"
                  value={revisionId}
                  onChange={(e) => setRevisionId(e.target.value)}
                  onKeyDown={(event) => {
                    const next = revisionAfterKey(view.revisions, revisionId, event.key);
                    if (!next) return;
                    event.preventDefault();
                    setRevisionId(next);
                  }}
                >
                  {view.revisions.map((r) => (
                    <option key={r.id} value={r.id}>
                      Revision {r.number} · {r.author}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button"
                disabled={protectedBranch}
                onClick={() => {
                  if (current) {
                    sourceRef.current = current.source;
                    baseRef.current = current.id;
                    setSource(current.source);
                    setBase(current.id);
                    proposalMessage.current = undefined;
                    dirty.current = true;
                    setCompare(true);
                    void saveDraft();
                  }
                }}
              >
                Use revision as draft
              </button>
              <button
                className="button"
                onClick={() => {
                  if (!current) return;
                  setBusy(true);
                  void api()
                    .artifactFork({ id: selected, revisionId: current.id })
                    .then(async (next) => {
                      await refreshList();
                      setSelected(next.artifact.id);
                    })
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setBusy(false));
                }}
              >
                Fork revision
              </button>
            </div>
            <ArtifactEditorTabs tab={tab} onChange={setTab} id={tabId} />
            <section
              role="tabpanel"
              id={`${tabId}-preview-panel`}
              aria-labelledby={`${tabId}-preview-tab`}
              hidden={tab !== 'preview'}
            >
              <h4>
                {view.artifact.title} · saved revision {current?.number}
              </h4>
              <p>
                The preview opens in a separate isolated window. It displays this saved revision;
                your working draft stays in Source until you save a revision.
              </p>
              <p className="muted small">
                Static preview · scripts, network, local files and desktop access are disabled.
              </p>
              <p role={previewStatus?.status === 'error' ? 'alert' : 'status'}>
                {previewStatus?.message ?? 'Choose Preview to open this saved revision.'}
              </p>
              <button
                className="button"
                disabled={previewStatus?.status === 'opening'}
                onClick={() => setPreviewSerial((serial) => serial + 1)}
              >
                Open preview again
              </button>
              <button className="button" onClick={() => setTab('source')}>
                Return to Source
              </button>
            </section>
            <section
              role="tabpanel"
              id={`${tabId}-source-panel`}
              aria-labelledby={`${tabId}-source-tab`}
              hidden={tab !== 'source'}
            >
              <details>
                <summary>Saved revision source</summary>
                <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                  {current?.source}
                </pre>
              </details>
              {protectedBranch && (
                <p>This chat is a branch. Fork the pinned revision before editing its source.</p>
              )}
              {protectedBranch && proposal && (
                <button
                  className="button"
                  onClick={() => {
                    setBusy(true);
                    void api()
                      .artifactFork({
                        id: selected,
                        revisionId: proposal.baseRevisionId,
                        source: proposal.source,
                      })
                      .then(async (next) => {
                        await refreshList();
                        setSelected(next.artifact.id);
                      })
                      .catch((e) => setError(errorText(e)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Save reviewed proposal as separate artifact
                </button>
              )}
              <label>
                Working source
                <textarea
                  aria-label="Artifact source"
                  rows={14}
                  spellCheck={false}
                  readOnly={protectedBranch}
                  value={source}
                  style={{ fontFamily: 'monospace', width: '100%' }}
                  onChange={(e) => {
                    const text = e.target.value;
                    sourceRef.current = text;
                    dirty.current = true;
                    setSource(text);
                    setNotice('Saving draft…');
                    clearTimeout(timer.current);
                    timer.current = setTimeout(() => void saveDraft(), 500);
                  }}
                />
              </label>
              <p className="muted small" role="status">
                {notice} · {new TextEncoder().encode(source).length.toLocaleString()} / 100,000
                bytes
              </p>
              {stale && (
                <p role="alert">
                  This draft is based on an older revision. Compare with the latest revision and
                  merge explicitly, or save a separate artifact.
                </p>
              )}
              <div className="row">
                <button className="button" onClick={() => setCompare(!compare)}>
                  Compare source
                </button>
                <button
                  className="button primary"
                  disabled={busy || stale || conflict.current || protectedBranch}
                  onClick={() => {
                    clearTimeout(timer.current);
                    setBusy(true);
                    setError('');
                    void saveDraft()
                      .then(() => {
                        if (conflict.current)
                          throw new Error('Resolve the draft conflict before saving a revision.');
                        return api().artifactCommit({
                          id: selected,
                          expectedHeadRevisionId: baseRef.current,
                          source: sourceRef.current,
                          author: proposalMessage.current ? 'model' : 'user',
                          sourceMessageId: proposalMessage.current,
                        });
                      })
                      .then((result) => {
                        if (!result.ok) {
                          setView(result.view);
                          setCompare(true);
                          setError('The artifact changed. Compare and merge before saving.');
                          return;
                        }
                        setEditor(result.view);
                        setNotice('New revision saved.');
                        void refreshList();
                      })
                      .catch((e) => setError(errorText(e)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Save revision
                </button>
                <button
                  className="button"
                  onClick={() => {
                    if (protectedBranch) {
                      setBusy(true);
                      void api()
                        .artifactFork({ id: selected, revisionId })
                        .then((next) => {
                          const r = next.revisions[0];
                          onAskToRevise({
                            artifactId: next.artifact.id,
                            revisionId: r.id,
                            title: next.artifact.title,
                            kind: next.artifact.kind,
                            source: r.source,
                          });
                        })
                        .catch((e) => setError(errorText(e)))
                        .finally(() => setBusy(false));
                      return;
                    }
                    const r = view.revisions.find((r) => r.id === view.artifact.headRevisionId)!;
                    onAskToRevise({
                      artifactId: selected,
                      revisionId: r.id,
                      title: view.artifact.title,
                      kind: view.artifact.kind,
                      source: r.source,
                    });
                  }}
                >
                  Ask to revise saved artifact
                </button>
                {onAttach && (
                  <button
                    className="button"
                    onClick={() => onAttach({ artifactId: selected, revisionId })}
                  >
                    Attach this revision
                  </button>
                )}
              </div>
              {compare && (
                <section aria-label="Artifact source comparison">
                  <h4>Base revision {previous?.number} → working draft</h4>
                  <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                    {previous?.source}
                  </pre>
                  <h4>Proposed source</h4>
                  <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                    {source}
                  </pre>
                  {stale || conflict.current ? (
                    <>
                      <h4>Latest revision</h4>
                      <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                        {view.revisions[0].source}
                      </pre>
                      <button
                        className="button"
                        disabled={protectedBranch}
                        onClick={() => {
                          baseRef.current = view.artifact.headRevisionId;
                          setBase(baseRef.current);
                          generation.current = view.draft?.generation ?? 0;
                          conflict.current = false;
                          dirty.current = true;
                          setError('');
                          setNotice('Merge your source with the latest revision, then save.');
                        }}
                      >
                        I reviewed the latest source; use it as merge base
                      </button>
                      <button
                        className="button"
                        onClick={() => {
                          setBusy(true);
                          void api()
                            .artifactFork({
                              id: selected,
                              revisionId: baseRef.current,
                              source: sourceRef.current,
                            })
                            .then(async (next) => {
                              await refreshList();
                              setSelected(next.artifact.id);
                            })
                            .catch((e) => setError(errorText(e)))
                            .finally(() => setBusy(false));
                        }}
                      >
                        Save draft as separate artifact
                      </button>
                    </>
                  ) : null}
                </section>
              )}
            </section>
            <div className="row">
              {(
                [
                  'source',
                  'pdf',
                  'json',
                  ...(view.artifact.kind === 'svg' || view.artifact.kind === 'mermaid'
                    ? ['svg']
                    : []),
                ] as ('source' | 'pdf' | 'json' | 'svg')[]
              ).map((format) => (
                <button
                  className="button"
                  key={format}
                  onClick={() =>
                    void api()
                      .artifactExport({ id: selected, revisionId, format })
                      .catch((e) => setError(errorText(e)))
                  }
                >
                  Export {format.toUpperCase()}
                </button>
              ))}
              <button
                className="button"
                disabled={busy || current?.id === view.artifact.headRevisionId || protectedBranch}
                onClick={() => {
                  setBusy(true);
                  void api()
                    .artifactRestore({
                      id: selected,
                      revisionId,
                      expectedHeadRevisionId: view.artifact.headRevisionId,
                    })
                    .then((result) => {
                      if (result.ok) setEditor(result.view);
                      else {
                        setView(result.view);
                        setError(
                          'The artifact changed. Review the latest revision before restoring.',
                        );
                      }
                    })
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setBusy(false));
                }}
              >
                Restore as new revision
              </button>
            </div>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

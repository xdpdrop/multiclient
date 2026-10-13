import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import type {
  ContextItem,
  ContextItemSummary,
  ContextRef,
  SaveContextItem,
} from '../../shared/context';

export function KnowledgeLibrary({
  projectId,
  onClose,
  onInclude,
}: {
  projectId: string;
  onClose: () => void;
  onInclude: (refs: ContextRef[]) => Promise<void> | void;
}) {
  const [items, setItems] = useState<ContextItemSummary[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [editing, setEditing] = useState<ContextItem | null>(null);
  const [kind, setKind] = useState<'note' | 'instructions'>('note');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [include, setInclude] = useState(false);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const request = useRef(0);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      request.current++;
    };
  }, [projectId]);
  async function refresh() {
    const token = ++request.current;
    setLoading(true);
    try {
      const result = await window.desktop.contextItems(projectId);
      if (alive.current && token === request.current) {
        const visible = result.filter((item) =>
          ['instructions', 'note', 'document'].includes(item.kind),
        );
        setItems(visible);
        setChosen((previous) => previous.filter((id) => visible.some((item) => item.id === id)));
      }
    } catch (failure) {
      if (alive.current) setError(String(failure));
    } finally {
      if (alive.current && token === request.current) setLoading(false);
    }
  }
  function reset(nextKind: 'note' | 'instructions' = 'note') {
    request.current++;
    setEditing(null);
    setKind(nextKind);
    setTitle(nextKind === 'instructions' ? 'Project instructions' : '');
    setText('');
    setInclude(nextKind === 'instructions');
    setError('');
    setNotice('');
  }
  async function edit(id: string) {
    const token = ++request.current;
    setBusy(true);
    setError('');
    try {
      const item = await window.desktop.contextItem(id);
      if (!alive.current || token !== request.current) return;
      setEditing(item);
      setKind(item.kind === 'instructions' ? 'instructions' : 'note');
      setTitle(item.title);
      setText(item.text);
      setInclude(item.includeInNewChats);
    } catch (failure) {
      if (alive.current && token === request.current) setError(String(failure));
    } finally {
      if (alive.current && token === request.current) setBusy(false);
    }
  }
  async function act(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function input(): SaveContextItem {
    return {
      id: editing?.id,
      expectedRevision: editing?.revision,
      projectId,
      kind: editing?.kind ?? kind,
      title,
      text,
      includeInNewChats: include,
      source: editing?.source,
      attachment: editing?.attachment,
    };
  }
  async function importFiles() {
    const files = await window.desktop.attachFiles();
    if (!alive.current || !files.length) return;
    if (files.some((file) => file.kind === 'image' || !file.content.trim()))
      throw new Error(
        'Import UTF-8 text or a PDF with extracted text. Images and scanned PDFs are not supported by project knowledge.',
      );
    let imported = 0;
    try {
      for (const file of files) {
        await window.desktop.saveContextItem({
          projectId,
          kind: 'document',
          title: file.name ?? file.path,
          text: file.content,
          includeInNewChats: false,
          attachment: { ...file, delivery: 'text' },
          source: {
            ...(file.assetId ? { assetId: file.assetId } : {}),
            ...(file.pages ? { pages: file.pages.map((page) => page.page) } : {}),
          },
        });
        imported++;
      }
    } finally {
      if (alive.current) {
        await refresh();
        setNotice(
          `Imported ${imported} of ${files.length} sources. Select saved sources before sharing them.`,
        );
      }
    }
  }
  async function replaceDocument() {
    const item = editing;
    const files = await window.desktop.attachFiles();
    if (!alive.current || !item || !files.length) return;
    if (files.length !== 1 || files[0].kind === 'image' || !files[0].content.trim())
      throw new Error(
        'Choose one text file or a PDF with extracted text to replace this document.',
      );
    const file = files[0];
    setEditing({
      ...item,
      attachment: { ...file, delivery: 'text' },
      source: {
        ...(file.assetId ? { assetId: file.assetId } : {}),
        ...(file.pages ? { pages: file.pages.map((page) => page.page) } : {}),
      },
    });
    setText(file.content);
    setNotice('Replacement loaded. Review it and save the source to create a new revision.');
  }
  const visible = items.filter((item) => item.title.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Dialog title="Project knowledge" wide onClose={onClose}>
      <div className="dialogBody">
        <p className="muted small">
          Keep reusable notes and documents locally. Selected sources are copied into a chat.
          Editing the library preserves every previously shared version.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="button" disabled={busy || loading} onClick={() => reset()}>
            New note
          </button>
          <button
            className="button"
            disabled={busy || loading}
            onClick={() => {
              const item = items.find((item) => item.kind === 'instructions');
              if (item) void edit(item.id);
              else reset('instructions');
            }}
          >
            Project instructions
          </button>
          <button
            className="button"
            disabled={busy || loading}
            onClick={() => void act(importFiles)}
          >
            Import text or PDF
          </button>
          <button className="button" disabled={busy || loading} onClick={() => void act(refresh)}>
            Refresh library
          </button>
        </div>
        <label>
          Filter knowledge
          <input
            aria-label="Filter knowledge"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        {visible.map((item) => (
          <div className="historyResult" key={item.id}>
            <label style={{ margin: 0 }}>
              <input
                type="checkbox"
                aria-label={`Share ${item.title}`}
                checked={chosen.includes(item.id)}
                disabled={busy}
                onChange={(event) =>
                  setChosen((previous) =>
                    event.target.checked
                      ? [...previous, item.id]
                      : previous.filter((id) => id !== item.id),
                  )
                }
              />{' '}
              {item.title}
            </label>
            <small>
              {item.kind} · revision {item.revision} · {item.characters.toLocaleString()} characters
              {item.includeInNewChats ? ' · included in new chats' : ''}
            </small>
            <button className="textButton" disabled={busy} onClick={() => void edit(item.id)}>
              Edit {item.title}
            </button>
          </div>
        ))}
        {loading && <p role="status">Loading project knowledge…</p>}
        {!loading && !items.length && (
          <p className="muted small">
            No saved knowledge yet. Add a note, instructions, or a document.
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || !chosen.length}
          onClick={() =>
            void act(async () => {
              const refs = await window.desktop.snapshotContextItems(chosen);
              if (!alive.current) return;
              await onInclude(refs);
              onClose();
            })
          }
        >
          Add selected sources to conversation
        </button>
        <hr />
        <h3>
          {editing
            ? `Edit ${editing.title}`
            : kind === 'instructions'
              ? 'New project instructions'
              : 'New note'}
        </h3>
        <label>
          Source title
          <input
            aria-label="Source title"
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Source text
          <textarea
            aria-label="Source text"
            rows={6}
            value={text}
            readOnly={editing?.kind === 'document'}
            disabled={busy}
            maxLength={kind === 'instructions' ? 20000 : 100000}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {editing?.kind === 'document' && (
          <button className="button" disabled={busy} onClick={() => void act(replaceDocument)}>
            Replace document
          </button>
        )}
        {editing?.attachment?.pages && (
          <fieldset>
            <legend>PDF pages shared as extracted text</legend>
            {editing.attachment.pages.map((page) => (
              <label key={page.page}>
                <input
                  type="checkbox"
                  checked={editing.source?.pages?.includes(page.page) ?? true}
                  disabled={busy}
                  onChange={(event) => {
                    const selected = new Set(
                      editing.source?.pages ??
                        editing.attachment!.pages!.map((value) => value.page),
                    );
                    if (event.target.checked) selected.add(page.page);
                    else selected.delete(page.page);
                    setEditing({
                      ...editing,
                      source: { ...editing.source, pages: [...selected].sort((a, b) => a - b) },
                    });
                    setText(
                      editing
                        .attachment!.pages!.filter(
                          (value) => selected.has(value.page) && value.text.trim(),
                        )
                        .map((value) => `[Page ${value.page}]\n${value.text}`)
                        .join('\n\n'),
                    );
                  }}
                />{' '}
                Page {page.page}
                {!page.text.trim() ? ' · no extracted text' : ''}
              </label>
            ))}
          </fieldset>
        )}
        <label>
          <input
            type="checkbox"
            checked={include}
            disabled={busy}
            onChange={(event) => setInclude(event.target.checked)}
          />{' '}
          Include this source in new chats
        </label>
        <p className="muted small">
          Instructions stay separate from history selection for API requests. Documents follow their
          sharing message and can be excluded from history. No automatic retrieval or OCR.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button
            className="button"
            disabled={busy || !title.trim() || !text.trim()}
            onClick={() =>
              void act(async () => {
                const saved = await window.desktop.saveContextItem(input());
                if (!alive.current) return;
                setEditing(saved);
                setNotice(
                  'Saved. Existing chats and unsent source snapshots keep their captured version.',
                );
                await refresh();
              })
            }
          >
            Save source
          </button>
          {editing && (
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await window.desktop.removeContextItem(editing.id, editing.revision);
                  if (!alive.current) return;
                  reset();
                  await refresh();
                  setNotice('Removed from the library. Shared snapshots are preserved.');
                })
              }
            >
              Remove source from library
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        <p role="status">{busy ? 'Preparing source…' : notice}</p>
      </div>
    </Dialog>
  );
}

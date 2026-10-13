import { useEffect, useRef, useState } from 'react';
import type { ContextSnapshot } from '../../shared/context';
import type { MemoryApi, MemoryNote, MemorySource } from '../../shared/memory';
import { Dialog } from '../components/Dialog';

type Editor = {
  id?: string;
  expectedRevision?: number;
  projectId: string | null;
  title: string;
  text: string;
  includeNewChats: boolean;
  source?: MemorySource;
};

export function MemoryLibrary({
  api,
  projectId,
  onClose,
  onInclude,
  onFreshChat,
  initialNote,
  onOpenSource,
}: {
  api: MemoryApi;
  projectId: string | null;
  onClose: () => void;
  onInclude: (snapshot: ContextSnapshot) => void | Promise<void>;
  onFreshChat: () => void | Promise<void>;
  initialNote?: { text: string; source?: MemorySource };
  onOpenSource?: (conversationId: string, messageId: string) => void;
}) {
  const empty = (): Editor => ({ projectId, title: '', text: '', includeNewChats: false });
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(
    initialNote ? { ...empty(), text: initialNote.text, source: initialNote.source } : null,
  );
  const [deleting, setDeleting] = useState<MemoryNote | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    ++generation.current;
    let active = true;
    setBusy(true);
    setError('');
    void api
      .memoryList(projectId)
      .then((result) => {
        if (active) setNotes(result);
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      ++generation.current;
    };
  }, [api, projectId]);
  const act = async (operation: (isCurrent: () => boolean) => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    const token = generation.current;
    const isCurrent = () => generation.current === token;
    try {
      await operation(isCurrent);
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const filtered = notes.filter((note) =>
    `${note.title}\n${note.text}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <Dialog title="Saved memory" wide onClose={onClose}>
      <div className="dialogBody">
        <p className="hint">
          Save notes yourself, then choose what to share. Nothing is inferred or saved
          automatically. Project notes stay in their project; global notes can be selected in any
          chat.
        </p>
        <p className="hint">
          Changes affect future sharing. Messages already sent and native provider sessions retain
          their previous memory snapshots. Starting fresh lets you leave that context behind.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <input
            aria-label="Search saved memory"
            placeholder="Find a saved note…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              setEditor(empty());
              setDeleting(null);
            }}
          >
            Add note
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void act(async (isCurrent) => {
                await onFreshChat();
                if (isCurrent()) onClose();
              })
            }
          >
            Start fresh without memory
          </button>
        </div>
        <div aria-live="polite">{busy ? 'Loading…' : `${filtered.length} saved notes`}</div>
        {!busy && !notes.length && <p>No notes saved here yet.</p>}
        {filtered.map((note) => (
          <section key={note.id} className="card">
            <strong>{note.title}</strong>
            <p className="hint">
              {note.projectId ? 'This project' : 'Global'} · Revision {note.revision}
              {note.includeNewChats ? ' · Included in new chats' : ' · Select to share'}
            </p>
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.text}</p>
            <div className="row">
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void act(async (isCurrent) => {
                    const snapshot = await api.memoryInclude(note.id, note.revision, projectId);
                    if (!isCurrent()) return;
                    await onInclude(snapshot);
                    if (isCurrent()) onClose();
                  })
                }
              >
                Add to draft
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setDeleting(null);
                  setEditor({ ...note, expectedRevision: note.revision });
                }}
              >
                Edit
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setDeleting(note);
                  setEditor(null);
                }}
              >
                Delete
              </button>
              {note.source && onOpenSource && (
                <button
                  className="button"
                  onClick={() => {
                    onOpenSource(note.source!.conversationId, note.source!.messageId);
                  }}
                >
                  View source message
                </button>
              )}
            </div>
          </section>
        ))}
        {deleting && (
          <section className="card" aria-label="Confirm memory deletion">
            <p>
              Delete “{deleting.title}” from saved memory? Existing messages and native sessions
              retain previously shared copies. Backups and exports can also retain those copies.
            </p>
            <div className="row">
              <button
                className="button danger"
                disabled={busy}
                onClick={() =>
                  void act(async (isCurrent) => {
                    await api.memoryDelete(deleting.id, deleting.revision);
                    if (!isCurrent()) return;
                    setNotes((current) => current.filter((note) => note.id !== deleting.id));
                    setDeleting(null);
                  })
                }
              >
                Delete saved note
              </button>
              <button className="button" disabled={busy} onClick={() => setDeleting(null)}>
                Cancel
              </button>
            </div>
          </section>
        )}
        {editor && (
          <form
            className="card"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async (isCurrent) => {
                const saved = await api.memorySave({
                  id: editor.id,
                  expectedRevision: editor.expectedRevision,
                  projectId: editor.projectId,
                  title: editor.title,
                  text: editor.text,
                  includeNewChats: editor.includeNewChats,
                  source: editor.source,
                });
                if (!isCurrent()) return;
                setNotes((current) => [saved, ...current.filter((note) => note.id !== saved.id)]);
                setEditor(null);
              });
            }}
          >
            <label>
              Title
              <input
                aria-label="Memory title"
                required
                maxLength={200}
                value={editor.title}
                onChange={(event) => setEditor({ ...editor, title: event.target.value })}
              />
            </label>
            <label>
              Note
              <textarea
                aria-label="Memory note"
                required
                rows={8}
                maxLength={10000}
                value={editor.text}
                onChange={(event) => setEditor({ ...editor, text: event.target.value })}
              />
            </label>
            <label>
              Scope
              <select
                aria-label="Memory scope"
                disabled={!!editor.id}
                value={editor.projectId ?? 'global'}
                onChange={(event) =>
                  setEditor({
                    ...editor,
                    projectId: event.target.value === 'global' ? null : event.target.value,
                  })
                }
              >
                <option value="global">Global</option>
                {projectId && <option value={projectId}>This project</option>}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={editor.includeNewChats}
                onChange={(event) =>
                  setEditor({ ...editor, includeNewChats: event.target.checked })
                }
              />
              Include in new chats{' '}
              {editor.projectId ? 'in this project' : 'in every project and personal chat'}
            </label>
            {editor.source && (
              <p className="hint">Saved from a message. Editing preserves that source reference.</p>
            )}
            <div className="row">
              <button
                className="button primary"
                type="submit"
                disabled={busy || !editor.title.trim() || !editor.text.trim()}
              >
                Save note
              </button>
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}

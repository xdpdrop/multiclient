import { useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog';
import type { Message } from '../../shared/types';
import type { ContextRef } from '../../shared/context';
import { ContextManifest } from './ContextManifest';

export function ContextSelection({
  conversationId,
  selectedIds,
  defaultSessionId,
  onApply,
  onClose,
  contextRefs = [],
  excludedIds = [],
  onSourcesChange,
}: {
  conversationId: string;
  selectedIds?: string[];
  defaultSessionId?: string | null;
  onApply: (ids: string[]) => void;
  onClose: () => void;
  contextRefs?: ContextRef[];
  excludedIds?: string[];
  onSourcesChange?: (refs: ContextRef[], excludedIds: string[]) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState(new Set(selectedIds));
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void window.desktop
      .transcript(conversationId)
      .then((data) => {
        if (active) {
          setMessages(data);
          setSelected(
            new Set(
              selectedIds ??
                data
                  .filter((message) => !defaultSessionId || message.sessionId === defaultSessionId)
                  .map((m) => m.id),
            ),
          );
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [conversationId]);
  const visible = messages
    .filter((m) => !query || m.text.toLowerCase().includes(query.toLowerCase()))
    .slice(-200);
  const chars = messages
    .filter((m) => selected.has(m.id))
    .reduce((sum, m) => sum + m.text.length + (m.context?.length ?? 0), 0);
  return (
    <Dialog title="Choose conversation context" wide onClose={onClose}>
      <div className="dialogBody">
        <p>
          Choose the saved messages to include in your next API request. Originals remain in
          history. Attachments from selected messages are included.
        </p>
        <p className="muted">
          Project instructions are pinned separately from message selection. Shared documents and
          memory can be excluded independently below.
        </p>
        {ready && onSourcesChange && (
          <ContextManifest
            refs={contextRefs}
            excludedIds={excludedIds}
            historicalSources={messages
              .filter((message) => selected.has(message.id))
              .flatMap((message) => message.contextSources ?? [])}
            onChange={onSourcesChange}
          />
        )}
        <p>
          {selected.size} messages · {chars.toLocaleString()} text characters. Model token-window
          information is unavailable.
        </p>
        <div className="row">
          <button
            className="button"
            onClick={() => setSelected(new Set(messages.map((m) => m.id)))}
          >
            Select all
          </button>
          <button className="button" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
        <input
          aria-label="Filter context messages"
          placeholder="Find a message…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="muted small">
          Showing the latest {visible.length} matching messages. Search to select older messages.
        </p>
        <div className="pdfPages">
          {visible.map((m) => (
            <label className="historyResult" key={m.id}>
              <input
                type="checkbox"
                checked={selected.has(m.id)}
                onChange={(e) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (e.target.checked) next.add(m.id);
                    else next.delete(m.id);
                    return next;
                  })
                }
              />
              <strong>{m.role === 'user' ? 'You' : m.providerId}</strong>
              <span>{m.text.slice(0, 200)}</span>
            </label>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        <button
          className="button primary"
          disabled={!ready}
          onClick={() => {
            onApply([...selected]);
            onClose();
          }}
        >
          Use selected context
        </button>
      </div>
    </Dialog>
  );
}

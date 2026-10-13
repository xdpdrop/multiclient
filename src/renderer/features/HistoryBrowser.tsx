import { useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { useApp } from '../state';
import type { Conversation, ProviderId, SearchResult } from '../../shared/types';
import type { ConversationTag } from '../../shared/organization';

export function HistoryBrowser({
  projectId,
  conversationId,
  onClose,
  initialArchive = false,
}: {
  projectId?: string;
  conversationId?: string;
  onClose: () => void;
  initialArchive?: boolean;
}) {
  const { snapshot, select, refresh, report } = useApp();
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('');
  const [tags, setTags] = useState<ConversationTag[]>([]);
  const [tag, setTag] = useState('');
  const [scope, setScope] = useState<'all' | 'project' | 'chat'>(
    conversationId ? 'chat' : projectId ? 'project' : 'all',
  );
  const [includeArchived, setIncludeArchived] = useState(false);
  const [archive, setArchive] = useState(initialArchive);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [archived, setArchived] = useState<Conversation[]>([]);
  const [queryBusy, setQueryBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const busy = queryBusy || actionBusy;
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void window.desktop
      .tags()
      .then((tags) => {
        if (active) setTags(tags);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setQueryBusy(true);
    setError('');
    const timer = setTimeout(() => {
      const request = archive
        ? window.desktop.archivedConversations()
        : query.trim() || tag
          ? window.desktop.search(query, {
              projectId: scope === 'project' ? projectId : undefined,
              conversationId: scope === 'chat' ? conversationId : undefined,
              providerId: provider ? (provider as ProviderId) : undefined,
              archived: includeArchived,
              tagIds: tag ? [tag] : undefined,
            })
          : Promise.resolve([]);
      void request
        .then((data) => {
          if (active) {
            if (archive) setArchived(data as Conversation[]);
            else setResults(data as SearchResult[]);
          }
        })
        .catch((e) => {
          if (active) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (active) setQueryBusy(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, provider, scope, projectId, conversationId, includeArchived, archive, tag]);
  const changeArchive = (nextArchive: boolean) => {
    if (nextArchive === archive) return;
    setQueryBusy(true);
    setArchive(nextArchive);
  };
  const act = async (operation: () => Promise<unknown>) => {
    setActionBusy(true);
    setError('');
    try {
      await operation();
      await refresh();
      if (archive) setArchived(await window.desktop.archivedConversations());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      report(e);
    } finally {
      setActionBusy(false);
    }
  };
  return (
    <Dialog title={archive ? 'Archive & backups' : 'Search conversations'} wide onClose={onClose}>
      <div className="dialogBody historyBrowser">
        <div className="row">
          <button className="button" aria-pressed={!archive} onClick={() => changeArchive(false)}>
            Search
          </button>
          <button className="button" aria-pressed={archive} onClick={() => changeArchive(true)}>
            Archive & backups
          </button>
        </div>
        {!archive && (
          <>
            <input
              autoFocus
              aria-label="Search message content"
              placeholder="Find a phrase in your saved conversations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="row">
              <label>
                Search scope
                <select
                  aria-label="Search scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as typeof scope)}
                >
                  <option value="all">All conversations</option>
                  {projectId && <option value="project">Current project</option>}
                  {conversationId && <option value="chat">Current conversation</option>}
                </select>
              </label>
              <label>
                Provider
                <select
                  aria-label="Search provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="">All providers</option>
                  {snapshot?.connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tag
                <select
                  aria-label="Search tag"
                  value={tag}
                  onChange={(event) => setTag(event.target.value)}
                >
                  <option value="">All tags</option>
                  {tags.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                />
                Include archived
              </label>
            </div>
          </>
        )}
        <div role={error ? 'alert' : 'status'}>
          {busy
            ? 'Searching…'
            : error ||
              (!archive && query.trim() && !results.length ? 'No matching saved messages.' : '')}
        </div>
        {archive
          ? archived.map((c) => (
              <div className="historyResult" key={c.id}>
                <strong>{c.title}</strong>
                <small>
                  {c.providerId} · {new Date(c.updatedAt).toLocaleString()}
                </small>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void act(() => window.desktop.restoreConversation(c.id))}
                >
                  Restore {c.title}
                </button>
              </div>
            ))
          : results.map((r, index) => (
              <button
                className="historyResult"
                key={`${r.conversationId}:${r.messageId ?? index}`}
                onClick={() => {
                  void select(r.conversationId, r.messageId ?? undefined).then(onClose);
                }}
              >
                <strong>
                  {r.title}
                  {r.archived ? ' · archived' : ''}
                </strong>
                <small>
                  {r.providerId} · {new Date(r.createdAt).toLocaleString()}
                </small>
                <span>{r.snippet}</span>
              </button>
            ))}
        {archive && (
          <>
            <p className="muted">
              Backups include conversations, drafts, settings and local assets. Credentials are
              excluded.
            </p>
            <div className="row">
              <button
                className="button"
                disabled={busy}
                onClick={() => void act(() => window.desktop.backup())}
              >
                Create backup
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => void act(() => window.desktop.restoreBackup())}
              >
                Restore backup
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const c = await window.desktop.importConversation();
                    if (c) {
                      await select(c.id);
                      onClose();
                    }
                  })
                }
              >
                Import conversation JSON
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

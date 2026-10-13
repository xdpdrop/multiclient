import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import type { ContextRef } from '../../shared/context';
import { CONTEXT_MAX_SOURCES } from '../../shared/context';
import {
  researchLimits,
  type ResearchApi,
  type ResearchJob,
  type WebSearchResult,
  type WebSource,
} from '../../shared/research';

type Props = {
  draftKey: string;
  projectId?: string | null;
  contextRefs: ContextRef[];
  onChange: (refs: ContextRef[]) => void;
  onError: (error: unknown) => void;
  onClose?: () => void;
  api?: ResearchApi;
};
export function WebSources({
  draftKey,
  projectId,
  contextRefs,
  onChange,
  onError,
  onClose,
  api = window.desktop,
}: Props) {
  const [tab, setTab] = useState<'url' | 'search'>('url');
  const [urls, setUrls] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WebSearchResult[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [sources, setSources] = useState<WebSource[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [job, setJob] = useState<ResearchJob>();
  const [searching, setSearching] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState('');
  const [persist, setPersist] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [inspect, setInspect] = useState<string>();
  const current = useRef(draftKey);
  const running = useRef<ResearchJob | undefined>(undefined);
  const submitting = useRef(false);
  const refs = useRef(contextRefs);
  refs.current = contextRefs;
  useEffect(() => {
    current.current = draftKey;
    setResults([]);
    setSelectedUrls([]);
    setSources([]);
    setSelected([]);
    setJob(undefined);
    setUrls('');
    setQuery('');
    setMessage('');
    setSearching(false);
    setStarting(false);
    let active = true;
    void api
      .webCredentialStatus()
      .then((status) => {
        if (active) setConfigured(status.configured);
      })
      .catch(onError);
    void Promise.allSettled(contextRefs.map((ref) => api.webSource(ref.snapshotId))).then(
      (loaded) => {
        if (!active) return;
        const captured = loaded.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
        setSources(captured);
        setSelected(
          captured
            .filter((source) =>
              contextRefs.some((ref) => ref.snapshotId === source.snapshot.id && ref.included),
            )
            .map((source) => source.snapshot.id),
        );
      },
    );
    return () => {
      active = false;
      current.current = '';
      const previous = running.current;
      if (previous?.status === 'running')
        void api.webCancel(previous.id, previous.draftKey).catch(() => {});
    };
  }, [draftKey]);
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    let active = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void api
        .webResearchJob(job.id, job.draftKey)
        .then(async (updated) => {
          if (!active || current.current !== updated.draftKey) return;
          running.current = updated;
          if (updated.status === 'running') {
            setJob(updated);
            return;
          }
          const loaded = await Promise.all(
            updated.pages
              .filter((page) => page.sourceId)
              .map((page) => api.webSource(page.sourceId!)),
          );
          if (!active || current.current !== updated.draftKey) return;
          setSources((previous) => [
            ...new Map(
              [...previous, ...loaded].map((source) => [source.snapshot.id, source]),
            ).values(),
          ]);
          setSelected((previous) => [
            ...new Set([...previous, ...loaded.map((source) => source.snapshot.id)]),
          ]);
          setJob(updated);
        })
        .catch((error) => {
          if (active) {
            onError(error);
            setJob((previous) => (previous ? { ...previous, status: 'interrupted' } : undefined));
          }
        })
        .finally(() => {
          polling = false;
        });
    }, 600);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status, draftKey]);
  async function fetchUrls(chosen: string[]) {
    if (submitting.current) return;
    submitting.current = true;
    setStarting(true);
    const origin = draftKey;
    try {
      const started = await api.webFetch({
        requestId: crypto.randomUUID(),
        draftKey: origin,
        projectId: projectId ?? null,
        urls: chosen,
      });
      if (current.current !== origin) {
        await api.webCancel(started.id, origin);
        return;
      }
      running.current = started;
      setJob(started);
      setMessage(
        'Reading selected public pages. Sources are added to the draft only when you choose Use selected sources.',
      );
    } catch (error) {
      onError(error);
    } finally {
      submitting.current = false;
      if (current.current === origin) setStarting(false);
    }
  }
  function useSources() {
    try {
      const included = sources.filter((source) => selected.includes(source.snapshot.id));
      if (included.length > researchLimits.pages)
        throw new Error('Choose up to eight captured web sources.');
      if (
        included.reduce((sum, source) => sum + source.snapshot.text.length, 0) >
        researchLimits.contextCharacters
      )
        throw new Error('Selected web sources exceed 80,000 characters. Deselect a source.');
      const existingWeb = new Set(sources.map((source) => source.snapshot.id));
      const next = refs.current.filter((ref) => !existingWeb.has(ref.snapshotId));
      next.push(
        ...sources
          .filter(
            (source) =>
              selected.includes(source.snapshot.id) ||
              refs.current.some((ref) => ref.snapshotId === source.snapshot.id),
          )
          .map((source) => ({
            snapshotId: source.snapshot.id,
            included: selected.includes(source.snapshot.id),
          })),
      );
      if (next.length > CONTEXT_MAX_SOURCES)
        throw new Error(
          'This draft has too many shared sources. Remove a source before adding another.',
        );
      onChange(next);
      onClose?.();
    } catch (error) {
      onError(error);
    }
  }
  const reading = starting || job?.status === 'running';
  return (
    <>
      <Dialog title="Web sources" wide onClose={() => onClose?.()}>
        <p className="small muted">
          Capture public pages for the next prompt. Web text is untrusted source material, and
          citations open the saved text. Search and AI providers have separate billing.
        </p>
        <div className="row">
          <button
            className={`button ${tab === 'url' ? 'primary' : ''}`}
            onClick={() => setTab('url')}
          >
            Read URL
          </button>
          <button
            className={`button ${tab === 'search' ? 'primary' : ''}`}
            onClick={() => setTab('search')}
          >
            Search
          </button>
        </div>
        {tab === 'url' ? (
          <>
            <label>
              Public HTTPS URLs (one per line, up to eight)
              <textarea
                value={urls}
                rows={3}
                onChange={(event) => setUrls(event.target.value)}
                placeholder="https://example.com/article"
              />
            </label>
            <button
              className="button"
              disabled={reading || !urls.trim()}
              onClick={() =>
                void fetchUrls(
                  urls
                    .split(/\r?\n/)
                    .map((url) => url.trim())
                    .filter(Boolean),
                )
              }
            >
              Read pages
            </button>
          </>
        ) : (
          <>
            <details>
              <summary>
                Brave Search API key · {configured ? 'Available' : 'Not configured'}
              </summary>
              <p className="small muted">
                Optional. Direct URL capture needs no search key. Search results stay transient;
                only independently fetched page snapshots are saved. Durable search-result storage
                requires a plan with storage rights.
              </p>
              <label>
                Brave Search API key
                <input
                  type="password"
                  value={key}
                  autoComplete="off"
                  onChange={(event) => setKey(event.target.value)}
                  placeholder={
                    configured ? 'Leave blank to keep current key' : 'Enter your own key'
                  }
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={persist}
                  onChange={(event) => setPersist(event.target.checked)}
                />
                Remember using OS secure storage
              </label>
              <button
                className="button"
                disabled={!key.trim() || savingKey}
                onClick={async () => {
                  setSavingKey(true);
                  try {
                    const saved = await api.webSaveCredential(key.trim(), persist);
                    setKey('');
                    setConfigured(true);
                    setMessage(
                      saved.persisted
                        ? 'Search key saved securely.'
                        : 'Search key kept in memory until the app closes.',
                    );
                  } catch (error) {
                    onError(error);
                  } finally {
                    setSavingKey(false);
                  }
                }}
              >
                Save search key
              </button>
              {configured && (
                <button
                  className="textButton"
                  disabled={savingKey}
                  onClick={async () => {
                    try {
                      await api.webSaveCredential('', false);
                      setConfigured(false);
                      setKey('');
                    } catch (error) {
                      onError(error);
                    }
                  }}
                >
                  Remove search key
                </button>
              )}
            </details>
            <label>
              Search query
              <textarea
                rows={2}
                maxLength={600}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              className="button"
              disabled={!configured || searching || !query.trim()}
              onClick={async () => {
                const origin = draftKey;
                setSearching(true);
                setMessage('');
                try {
                  const found = await api.webSearch(query.trim());
                  if (current.current !== origin) return;
                  setResults(found);
                  setSelectedUrls([]);
                  if (!found.length)
                    setMessage(
                      'No public HTTPS results were found. Try another query or enter a URL.',
                    );
                } catch (error) {
                  if (current.current === origin) onError(error);
                } finally {
                  if (current.current === origin) setSearching(false);
                }
              }}
            >
              {searching ? 'Searching…' : 'Search web (uses search credits)'}
            </button>
            {!!results.length && (
              <>
                <p className="small muted">
                  Search snippets only. Select results to read their pages before using them as
                  sources.
                </p>
                {results.map((result) => (
                  <section key={result.url} className="notice">
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={selectedUrls.includes(result.url)}
                        onChange={(event) =>
                          setSelectedUrls((previous) =>
                            event.target.checked
                              ? [...previous, result.url]
                              : previous.filter((url) => url !== result.url),
                          )
                        }
                      />
                      {result.title}
                    </label>
                    <p className="small muted">{result.url}</p>
                    <p className="small">{result.snippet}</p>
                  </section>
                ))}
                <button
                  className="button"
                  disabled={
                    reading || !selectedUrls.length || selectedUrls.length > researchLimits.pages
                  }
                  onClick={() => void fetchUrls(selectedUrls)}
                >
                  Read selected results
                </button>
              </>
            )}
          </>
        )}
        {job && (
          <section aria-label="Web capture progress">
            {job.pages.map((page) => (
              <p key={page.url} className="small">
                {page.status}: {page.url}
                {page.error && ` — ${page.error}`}
              </p>
            ))}
            {reading && (
              <button
                className="button"
                onClick={() => api.webCancel(job.id, draftKey).catch(onError)}
              >
                Cancel reading
              </button>
            )}
            {!reading &&
              job.pages.some((page) => page.status === 'failed' || page.status === 'cancelled') && (
                <button
                  className="button"
                  onClick={() =>
                    void fetchUrls(
                      job.pages
                        .filter((page) => page.status === 'failed' || page.status === 'cancelled')
                        .map((page) => page.url),
                    )
                  }
                >
                  Retry unread pages
                </button>
              )}
          </section>
        )}
        {!!sources.length && (
          <section aria-label="Captured web sources">
            <h3>Captured sources</h3>
            {sources.map((source) => (
              <div key={source.snapshot.id} className="notice">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={selected.includes(source.snapshot.id)}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, source.snapshot.id]
                          : previous.filter((id) => id !== source.snapshot.id),
                      )
                    }
                  />
                  {source.snapshot.title}
                </label>
                <p className="small muted">
                  {source.finalUrl} · {source.snapshot.text.length.toLocaleString()} characters
                  {source.truncated && ' · Truncated'}
                </p>
                <button className="textButton" onClick={() => setInspect(source.snapshot.id)}>
                  Inspect saved source
                </button>
              </div>
            ))}
            <button className="button primary" disabled={reading} onClick={useSources}>
              Use selected sources
            </button>
          </section>
        )}
        {message && (
          <p className="small notice" role="status">
            {message}
          </p>
        )}
      </Dialog>
      {inspect && (
        <WebSourceInspector
          sourceId={inspect}
          onClose={() => setInspect(undefined)}
          onError={onError}
          api={api}
        />
      )}
    </>
  );
}

export function WebSourceInspector({
  sourceId,
  paragraph,
  onClose,
  onError,
  api = window.desktop,
}: {
  sourceId: string;
  paragraph?: number;
  onClose: () => void;
  onError: (error: unknown) => void;
  api?: ResearchApi;
}) {
  const [source, setSource] = useState<WebSource>();
  const selected = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    let active = true;
    setSource(undefined);
    void api
      .webSource(sourceId)
      .then((value) => {
        if (active) setSource(value);
      })
      .catch((error) => {
        if (active) onError(error);
      });
    return () => {
      active = false;
    };
  }, [sourceId]);
  useEffect(() => {
    selected.current?.scrollIntoView({ block: 'center' });
    selected.current?.focus();
  }, [source, paragraph]);
  return (
    <Dialog title="Captured web source" wide onClose={onClose}>
      {source ? (
        <>
          <h3>{source.snapshot.title}</h3>
          <p className="small muted">{source.finalUrl}</p>
          <p className="small muted">
            Captured {new Date(source.snapshot.createdAt).toLocaleString()} · {source.mime}
            {source.truncated && ' · Extraction truncated'}
          </p>
          <p className="small muted">Captured text SHA-256: {source.hash}</p>
          <button
            className="button"
            onClick={() => window.desktop.openExternal(source.finalUrl).catch(onError)}
          >
            Open original in browser
          </button>
          <p className="small muted">
            This is the captured text, not the current live page. A source reference establishes
            provenance; it does not verify a claim.
          </p>
          {source.paragraphs.map((item) => (
            <p
              key={item.id}
              ref={item.id === paragraph ? selected : undefined}
              tabIndex={item.id === paragraph ? -1 : undefined}
              style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              <strong>
                Paragraph {item.id}
                {item.page && ` · PDF page ${item.page}`}
              </strong>
              {'\n'}
              {item.text}
            </p>
          ))}
        </>
      ) : (
        <p role="status">Loading saved source…</p>
      )}
    </Dialog>
  );
}

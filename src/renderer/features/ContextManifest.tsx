import { useEffect, useRef, useState } from 'react';
import type { ContextRef, ContextSnapshot, ContextSnapshotSummary } from '../../shared/context';
import { useApp } from '../state';

type Source = ContextSnapshot | ContextSnapshotSummary;
export function SourceSnapshots({ sources }: { sources: ContextSnapshot[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Shared sources ({sources.length})</summary>
      {open && sources.map((source) => <SourceDisclosure key={source.id} source={source} />)}
    </details>
  );
}
function SourceDisclosure({ source }: { source: ContextSnapshot }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {source.title} · revision {source.revision}
      </summary>
      {open && <SourcePreview source={source} />}
    </details>
  );
}
function SourcePreview({ source }: { source: ContextSnapshot }) {
  const report = useApp((state) => state.report);
  return (
    <section className="notice">
      <strong>{source.title}</strong>
      <p className="muted small">
        {source.kind} · captured revision {source.revision}
        {source.source?.retrievedAt
          ? ` · retrieved ${new Date(source.source.retrievedAt).toLocaleString()}`
          : ''}
      </p>
      {source.source?.url && /^https?:\/\//i.test(source.source.url) && (
        <button
          type="button"
          className="textButton"
          onClick={() => void window.desktop.openExternal(source.source!.url!).catch(report)}
        >
          Open source website
        </button>
      )}
      {source.source?.pages?.length && (
        <p className="small">Pages: {source.source.pages.join(', ')}</p>
      )}
      <pre className="filePreview">{source.text}</pre>
    </section>
  );
}
export function ContextManifest({
  refs,
  excludedIds = [],
  historicalSources = [],
  onChange,
}: {
  refs: ContextRef[];
  excludedIds?: string[];
  historicalSources?: Source[];
  onChange: (refs: ContextRef[], excludedIds: string[]) => void;
}) {
  const [pending, setPending] = useState<ContextSnapshot[]>([]);
  const [stale, setStale] = useState<string[]>([]);
  const [preview, setPreview] = useState<ContextSnapshot | null>(null);
  const [error, setError] = useState('');
  const [statusRevision, setStatusRevision] = useState(0);
  const previewRequest = useRef(0);
  const ids = refs.map((ref) => ref.snapshotId).join(',');
  useEffect(() => {
    let active = true;
    setError('');
    setPending([]);
    setPreview(null);
    void window.desktop
      .contextSnapshots(refs.map((ref) => ref.snapshotId))
      .then(async (sources) => {
        const changed = await Promise.all(
          sources.map(async (source) => {
            if (!source.itemId) return null;
            try {
              return (await window.desktop.contextItem(source.itemId)).revision === source.revision
                ? null
                : source.id;
            } catch {
              return source.id;
            }
          }),
        );
        if (active) {
          setPending(sources);
          setStale(changed.filter((id): id is string => !!id));
        }
      })
      .catch((failure) => {
        if (active) setError(String(failure));
      });
    return () => {
      active = false;
      previewRequest.current++;
    };
  }, [ids, statusRevision]);
  const historical = [...new Map(historicalSources.map((source) => [source.id, source])).values()];
  const sources = [
    ...new Map([...historical, ...pending].map((source) => [source.id, source])).values(),
  ];
  const characters = sources
    .filter(
      (source) =>
        !excludedIds.includes(source.id) &&
        (refs.find((ref) => ref.snapshotId === source.id)?.included ??
          source.kind !== 'instructions'),
    )
    .reduce(
      (total, source) => total + ('text' in source ? source.text.length : source.characters),
      0,
    );
  return (
    <details className="notice">
      <summary>
        Sources ({sources.length}) · {characters.toLocaleString()} characters
      </summary>
      {!!refs.length && (
        <button
          type="button"
          className="textButton"
          onClick={() => setStatusRevision((value) => value + 1)}
        >
          Refresh source status
        </button>
      )}
      <p className="muted small">
        Pinned instructions are independent of selected API history. Other historical sources follow
        the message that shared them. Uncheck a source to exclude it explicitly.
      </p>
      {sources.map((source) => {
        const ref = refs.find((ref) => ref.snapshotId === source.id);
        const shared = historical.some((item) => item.id === source.id);
        const changed = stale.includes(source.id) && !shared && !ref?.reviewed;
        return (
          <section key={source.id}>
            <label>
              <input
                type="checkbox"
                checked={
                  !!(ref?.included ?? (shared && source.kind !== 'instructions')) &&
                  !excludedIds.includes(source.id)
                }
                onChange={(event) => {
                  const next = refs.map((ref) =>
                    ref.snapshotId === source.id ? { ...ref, included: event.target.checked } : ref,
                  );
                  const exclusions = event.target.checked
                    ? excludedIds.filter((id) => id !== source.id)
                    : [...new Set([...excludedIds, source.id])];
                  if (!ref && source.kind === 'instructions')
                    next.push({ snapshotId: source.id, included: event.target.checked });
                  onChange(next, exclusions);
                }}
              />{' '}
              {source.title} · revision {source.revision}
              {source.kind === 'instructions' ? ' · pinned instructions' : ''}
            </label>
            <button
              type="button"
              className="textButton"
              onClick={() => {
                const token = ++previewRequest.current;
                void window.desktop
                  .contextSnapshot(source.id)
                  .then((snapshot) => {
                    if (token === previewRequest.current) setPreview(snapshot);
                  })
                  .catch((failure) => {
                    if (token === previewRequest.current) setError(String(failure));
                  });
              }}
            >
              Preview {source.title}
            </button>
            {changed && (
              <p className="small">
                The library source changed or was removed. Your captured version is preserved.{' '}
                <button
                  type="button"
                  className="textButton"
                  onClick={() =>
                    onChange(
                      refs.map((ref) =>
                        ref.snapshotId === source.id ? { ...ref, reviewed: true } : ref,
                      ),
                      excludedIds,
                    )
                  }
                >
                  Use captured version of {source.title}
                </button>
              </p>
            )}
          </section>
        );
      })}
      {preview && (
        <>
          <button type="button" className="textButton" onClick={() => setPreview(null)}>
            Close source preview
          </button>
          <SourcePreview source={preview} />
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

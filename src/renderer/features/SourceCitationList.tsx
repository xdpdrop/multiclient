import { useEffect, useState } from 'react';
import type { ResearchApi, SourceCitationAudit } from '../../shared/research';

export function SourceCitationList({
  audit,
  onInspect,
  api = window.desktop,
}: {
  audit: SourceCitationAudit;
  onInspect: (sourceId: string, paragraph: number) => void;
  api?: ResearchApi;
}) {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState(50);
  const citations = [
    ...new Map(
      audit.valid.map((citation) => [`${citation.snapshotId}:${citation.paragraph}`, citation]),
    ).values(),
  ];
  const ids = [...new Set(citations.map((citation) => citation.snapshotId))];
  useEffect(() => {
    let active = true;
    void Promise.allSettled(
      ids.map(async (id) => [id, (await api.webSource(id)).snapshot.title] as const),
    ).then((results) => {
      if (active)
        setTitles(
          Object.fromEntries(
            results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
          ),
        );
    });
    return () => {
      active = false;
    };
  }, [ids.join(',')]);
  if (!audit.sources.length && !audit.unresolved.length && !audit.truncated) return null;
  return (
    <section aria-label="Saved source references" className="small">
      {!!citations.length && (
        <details>
          <summary>
            {citations.length} saved source {citations.length === 1 ? 'reference' : 'references'}
          </summary>
          {citations.slice(0, limit).map((citation) => (
            <button
              key={citation.token}
              className="textButton"
              onClick={() => onInspect(citation.snapshotId, citation.paragraph)}
            >
              {titles[citation.snapshotId] ?? `Source ${ids.indexOf(citation.snapshotId) + 1}`} ·
              paragraph {citation.paragraph}
            </button>
          ))}
          {citations.length > limit && (
            <button className="textButton" onClick={() => setLimit(limit + 50)}>
              Show more references
            </button>
          )}
        </details>
      )}
      {!citations.length && !!audit.sources.length && (
        <p className="muted">No source citations produced.</p>
      )}
      {!!audit.unresolved.length && (
        <p className="muted">
          {audit.unresolved.length} unresolved source{' '}
          {audit.unresolved.length === 1 ? 'reference' : 'references'}. These could not be matched
          to submitted source paragraphs.
        </p>
      )}
      {audit.truncated && (
        <p className="muted">
          Source reference audit truncated.
          {audit.omittedOccurrences
            ? ` ${audit.omittedOccurrences.toLocaleString()} additional marker occurrences were omitted.`
            : ''}{' '}
          Additional markers remain unverified. The response text has been preserved.
        </p>
      )}
      {!!citations.length && (
        <p className="muted">
          References open captured text. They establish provenance, not independent verification.
        </p>
      )}
    </section>
  );
}

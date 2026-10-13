import { useEffect, useRef, useState } from 'react';
import type {
  ComparisonApi,
  ComparisonGroup,
  ComparisonInput,
  ComparisonTarget,
} from '../../shared/comparison';
import type { Connection, Conversation, Message } from '../../shared/types';
import type { ContextSnapshot } from '../../shared/context';
import { Dialog } from '../components/Dialog';
import { Markdown } from '../components/Markdown';
import styles from './Comparison.module.css';

export type ComparisonLaunch = Omit<ComparisonInput, 'requestId' | 'targets' | 'pdfDelivery'>;
export function Comparison({
  connections,
  input,
  groupId,
  onClose,
  onContinue,
}: {
  connections: Connection[];
  input?: ComparisonLaunch;
  groupId?: string;
  onClose: () => void;
  onContinue: (conversation: Conversation) => void;
}) {
  const api = window.desktop as typeof window.desktop & ComparisonApi;
  const enabled = connections.filter((c) => c.enabled && c.kind === 'api-chat');
  const first = enabled[0];
  const second = enabled[1] ?? first;
  const targetFor = (connection?: Connection): ComparisonTarget => ({
    providerId: (connection?.id as ComparisonTarget['providerId']) ?? 'openai',
    model: connection?.model ?? '',
  });
  const [targets, setTargets] = useState<ComparisonTarget[]>([targetFor(first), targetFor(second)]);
  const [pdfDelivery, setPdfDelivery] = useState<'native' | 'text'>('native');
  const [group, setGroup] = useState<ComparisonGroup | null>(null);
  const [groups, setGroups] = useState<ComparisonGroup[]>([]);
  const [openedId, setOpenedId] = useState(groupId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sources, setSources] = useState<ContextSnapshot[]>([]);
  const [artifactSources, setArtifactSources] = useState<
    { title: string; number: number; source: string }[]
  >([]);
  const [sourcesReady, setSourcesReady] = useState(
    !input?.contextRefs?.some((ref) => ref.included) && !input?.artifactReferences?.length,
  );
  const [selected, setSelected] = useState(new Set(input?.historyMessageIds));
  const [historyReady, setHistoryReady] = useState(!input?.sourceConversationId);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const loadGeneration = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (input?.sourceConversationId) {
      setHistoryReady(false);
      void api
        .transcript(input.sourceConversationId)
        .then((history) => {
          if (!active) return;
          setMessages(history);
          setSelected(
            new Set(
              input.historyMessageIds ??
                history.filter((m) => m.status !== 'streaming').map((m) => m.id),
            ),
          );
          setHistoryReady(true);
        })
        .catch((e) => {
          if (active) setError(String(e instanceof Error ? e.message : e));
        });
    }
    const ids =
      input?.contextRefs?.filter((ref) => ref.included).map((ref) => ref.snapshotId) ?? [];
    const artifactRefs = input?.artifactReferences ?? [];
    if (ids.length || artifactRefs.length) {
      setSourcesReady(false);
      void Promise.all([
        ids.length ? api.contextSnapshots(ids) : Promise.resolve([]),
        Promise.all(
          artifactRefs.map(async (reference) => {
            const view = await api.artifactRead(reference.artifactId);
            const revision = view.revisions.find(
              (revision) => revision.id === reference.revisionId,
            );
            if (!revision) throw new Error('The attached artifact revision is unavailable.');
            return { title: view.artifact.title, number: revision.number, source: revision.source };
          }),
        ),
      ])
        .then(([sources, artifacts]) => {
          if (active) {
            setSources(sources);
            setArtifactSources(artifacts);
            setSourcesReady(true);
          }
        })
        .catch((e) => {
          if (active) setError(String(e instanceof Error ? e.message : e));
        });
    }
    return () => {
      active = false;
    };
  }, [input?.sourceConversationId]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const generation = ++loadGeneration.current;
      try {
        if (openedId) {
          const result = await api.comparison(openedId);
          if (active && generation === loadGeneration.current) setGroup(result);
        } else if (!input) {
          const result = await api.comparisons();
          if (active && generation === loadGeneration.current) setGroups(result);
        }
      } catch (e) {
        if (active) setError(String(e instanceof Error ? e.message : e));
      }
    };
    void load();
    const unsubscribe = api.onEvent((event) => {
      if (
        event.type === 'conversation' ||
        event.type === 'changed' ||
        event.type === 'runtime-state'
      ) {
        clearTimeout(timer);
        timer = setTimeout(() => void load(), 150);
      }
    });
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [openedId]);
  async function start() {
    if (!input || busy) return;
    setBusy(true);
    setError('');
    try {
      const prepared = await api.prepareComparison({
        ...input,
        requestId: crypto.randomUUID(),
        historyMessageIds: input.sourceConversationId ? [...selected] : undefined,
        targets,
        pdfDelivery,
      });
      // The send was explicitly requested before preparation; closing the dialog does not repeat it.
      const result = await api.startComparison(prepared.id);
      if (alive.current) {
        setOpenedId(result.id);
        setGroup(result);
      }
    } catch (e) {
      if (alive.current) setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function cancel(conversationId?: string) {
    if (!group) return;
    try {
      await api.cancelComparison(group.id, conversationId);
      setGroup(await api.comparison(group.id));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }
  async function continueWith(conversationId: string) {
    if (!group) return;
    try {
      const conversation = await api.continueComparison(group.id, conversationId);
      onContinue(conversation);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }
  const running = group?.members.some((m) => ['starting', 'running', 'waiting'].includes(m.status));
  const distinct =
    new Set(targets.map((t) => `${t.providerId}:${t.model.trim()}`)).size === targets.length;
  const visible = messages
    .filter((m) => !filter || m.text.toLowerCase().includes(filter.toLowerCase()))
    .slice(-200);
  const historicalSources = messages
    .filter((message) => selected.has(message.id))
    .flatMap((message) => message.contextSources ?? [])
    .filter((source) => !input?.excludedContextSnapshotIds?.includes(source.id));
  const instructionCandidates = (
    input?.contextRefs === undefined ? historicalSources : sources
  ).filter((source) => source.kind === 'instructions');
  const pinnedInstructions = [
    ...new Map(
      instructionCandidates.map((source) => [source.itemId ?? source.id, source]),
    ).values(),
  ];
  const manifestSources = [
    ...new Map(
      [
        ...historicalSources.filter((source) => source.kind !== 'instructions'),
        ...sources.filter((source) => source.kind !== 'instructions'),
        ...pinnedInstructions,
      ].map((source) => [source.id, source]),
    ).values(),
  ];
  const manifestAttachments = [
    ...messages
      .filter((message) => selected.has(message.id))
      .flatMap((message) => message.attachments ?? []),
    ...(input?.attachments ?? []),
  ];
  return (
    <Dialog title="Compare models" wide onClose={onClose}>
      <div className="dialogBody">
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {group ? (
          <>
            <div className="row">
              <h3>{group.title}</h3>
              {running && (
                <button className="button" onClick={() => void cancel()}>
                  Stop all
                </button>
              )}
            </div>
            <p className="muted small">
              Each response uses a separate API request. Results stay saved when you close this
              view. Interrupted requests are never replayed automatically.
            </p>
            <div className={styles.lanes}>
              {group.members.map((member, index) => (
                <section
                  className={styles.lane}
                  key={member.conversationId}
                  aria-label={`Comparison ${index + 1}: ${member.model}`}
                >
                  <h3>{member.model}</h3>
                  <p className="muted">
                    {member.providerId} · <span role="status">{member.status}</span>
                  </p>
                  {member.error && (
                    <p role="alert" className={styles.error}>
                      {member.error}
                    </p>
                  )}
                  {member.text ? (
                    <Markdown text={member.text} />
                  ) : (
                    <p className="muted">
                      {member.status === 'prepared'
                        ? 'Prepared draft; no request sent.'
                        : 'No response text yet.'}
                    </p>
                  )}
                  {member.usage && (
                    <p className="muted small">
                      Input: {member.usage.inputTokens ?? 'unavailable'} · Output:{' '}
                      {member.usage.outputTokens ?? 'unavailable'} tokens
                    </p>
                  )}
                  <div className="row">
                    {['starting', 'running', 'waiting'].includes(member.status) && (
                      <button className="button" onClick={() => void cancel(member.conversationId)}>
                        Stop this model
                      </button>
                    )}
                    {member.status === 'completed' && (
                      <button
                        className="button primary"
                        onClick={() => void continueWith(member.conversationId)}
                      >
                        Continue with this answer
                      </button>
                    )}
                    <button
                      className="button"
                      onClick={() =>
                        void api
                          .conversation(member.conversationId)
                          .then((view) => onContinue(view.conversation))
                          .catch((e) => setError(String(e instanceof Error ? e.message : e)))
                      }
                    >
                      Open saved chat
                    </button>
                  </div>
                </section>
              ))}
            </div>
          </>
        ) : input ? (
          <>
            <p>
              Send the same reviewed prompt and context to 2–3 models. Each target incurs its own
              API usage.
            </p>
            {!enabled.length && (
              <p role="alert">Enable an API Chat connection in Connections first.</p>
            )}
            {targets.map((target, index) => (
              <div className={styles.target} key={index}>
                <label>
                  Provider {index + 1}
                  <select
                    aria-label={`Comparison provider ${index + 1}`}
                    value={target.providerId}
                    onChange={(e) => {
                      const chosen = enabled.find((c) => c.id === e.target.value);
                      setTargets((items) =>
                        items.map((t, i) => (i === index ? targetFor(chosen) : t)),
                      );
                    }}
                  >
                    {enabled.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Model {index + 1}
                  <input
                    aria-label={`Comparison model ${index + 1}`}
                    value={target.model}
                    placeholder="Model ID"
                    onChange={(e) =>
                      setTargets((items) =>
                        items.map((t, i) => (i === index ? { ...t, model: e.target.value } : t)),
                      )
                    }
                  />
                </label>
                {index === 2 && (
                  <button
                    className="button"
                    onClick={() => setTargets((items) => items.slice(0, 2))}
                  >
                    Remove model 3
                  </button>
                )}
              </div>
            ))}
            {targets.length < 3 && (
              <button
                className="button"
                disabled={!enabled.length}
                onClick={() => setTargets((items) => [...items, targetFor(enabled[2] ?? first)])}
              >
                Add third model
              </button>
            )}
            {!distinct && <p className="muted">Choose distinct provider/model pairs.</p>}
            <h3>Context sent to every model</h3>
            <details>
              <summary>Prompt ({input.text.length.toLocaleString()} characters)</summary>
              <pre className={styles.prompt}>{input.text}</pre>
            </details>
            <p>
              {manifestAttachments.length} attachments · {selected.size} saved messages ·{' '}
              {manifestSources.length} shared sources · {input.artifactReferences?.length ?? 0}{' '}
              artifact revisions
            </p>
            {!!manifestAttachments.length && (
              <ul>
                {manifestAttachments.map((a, index) => (
                  <li key={index}>{a.name ?? a.path}</li>
                ))}
              </ul>
            )}
            {!!manifestSources.length && (
              <ul>
                {manifestSources.map((source) => (
                  <li key={source.id}>
                    <details>
                      <summary>
                        {source.title} · revision {source.revision} · {source.kind}
                      </summary>
                      <pre className={styles.prompt}>{source.text}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {artifactSources.map((artifact, index) => (
              <details key={index}>
                <summary>
                  {artifact.title} · revision {artifact.number}
                </summary>
                <pre className={styles.prompt}>{artifact.source}</pre>
              </details>
            ))}
            <label>
              PDF delivery
              <select
                aria-label="Comparison PDF delivery"
                value={pdfDelivery}
                onChange={(e) => setPdfDelivery(e.target.value as typeof pdfDelivery)}
              >
                <option value="native">Native documents for every model</option>
                <option value="text">Extracted text for every model</option>
              </select>
            </label>
            <p className="muted small">
              Images require support from every model. Extracted PDF text omits document visuals.
              Model token-window information is unavailable.
            </p>
            {!!messages.length && (
              <details>
                <summary>Choose saved history ({selected.size} messages)</summary>
                <div className="row">
                  <button
                    className="button"
                    onClick={() =>
                      setSelected(
                        new Set(messages.filter((m) => m.status !== 'streaming').map((m) => m.id)),
                      )
                    }
                  >
                    Select all completed messages
                  </button>
                  <button className="button" onClick={() => setSelected(new Set())}>
                    Clear selection
                  </button>
                </div>
                <input
                  aria-label="Filter comparison history"
                  value={filter}
                  placeholder="Find older messages…"
                  onChange={(e) => setFilter(e.target.value)}
                />
                <p className="muted small">
                  Showing the latest {visible.length} matching messages. Search includes stored
                  history.
                </p>
                <div className={styles.history}>
                  {visible.map((message) => (
                    <label key={message.id} className={styles.historyItem}>
                      <input
                        type="checkbox"
                        checked={selected.has(message.id)}
                        disabled={message.status === 'streaming'}
                        onChange={(e) =>
                          setSelected((ids) => {
                            const next = new Set(ids);
                            if (e.target.checked) next.add(message.id);
                            else next.delete(message.id);
                            return next;
                          })
                        }
                      />
                      <span>
                        {message.role}: {message.text.slice(0, 200)}
                        {message.attachments?.length
                          ? ` (${message.attachments.length} attachments)`
                          : ''}
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            )}
            <button
              className="button primary"
              disabled={
                busy ||
                !historyReady ||
                !sourcesReady ||
                !enabled.length ||
                !distinct ||
                !input.text.trim() ||
                targets.some((t) => !t.model.trim())
              }
              onClick={() => void start()}
            >
              {busy ? 'Preparing comparison…' : `Send to ${targets.length} models`}
            </button>
          </>
        ) : (
          <>
            <p className="muted">Saved comparisons</p>
            {!groups.length && (
              <p>No comparisons yet. Use Compare beside the composer to start one.</p>
            )}
            {groups.map((saved) => (
              <button key={saved.id} className={styles.saved} onClick={() => setOpenedId(saved.id)}>
                <strong>{saved.title}</strong>
                <span>{saved.members.map((m) => `${m.model}: ${m.status}`).join(' · ')}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}

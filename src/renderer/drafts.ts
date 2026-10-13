import { useLayoutEffect, useRef, useState } from 'react';
import type { Draft } from '../shared/types';

const cache = new Map<string, Draft>();
const writes = new Map<string, Promise<void>>();
export async function newDraftContext(projectId?: string) {
  const [project, memory] = await Promise.all([
    projectId ? window.desktop.projectContextDefaults(projectId) : Promise.resolve([]),
    window.desktop.memoryDefaults(projectId ?? null),
  ]);
  return [...project, ...memory.map((source) => ({ snapshotId: source.id, included: true }))];
}
export function persistDraft(key: string, draft: Draft | null): Promise<void> {
  const next = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => window.desktop.saveDraft(key, draft));
  writes.set(key, next);
  void next
    .finally(() => {
      if (writes.get(key) === next) writes.delete(key);
    })
    .catch(() => {});
  return next;
}
export function useComposerDraft(
  key: string,
  fallback: Draft,
  report: (error: unknown) => void,
  contextReady = true,
  projectId?: string,
) {
  const [draft, setValue] = useState<Draft>(fallback);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const valueReady = useRef(false);
  const activeKey = useRef(key);
  const generation = useRef(0);
  const value = useRef(draft);
  useLayoutEffect(() => {
    activeKey.current = key;
    const token = ++generation.current;
    setReady(false);
    valueReady.current = false;
    setLoadError('');
    if (!contextReady) return;
    const cached = cache.get(key);
    if (cached) {
      const next =
        key.startsWith('new:') && cached.mode === 'code-bypass'
          ? { ...cached, mode: 'code' }
          : cached;
      cache.set(key, next);
      value.current = next;
      setValue(next);
      setReady(true);
      valueReady.current = true;
      return;
    }
    setValue(fallback);
    void window.desktop
      .draft(key)
      .then(async (saved) => {
        const defaults =
          !saved && key.startsWith('new:') && projectId
            ? await window.desktop.projectDefaults(projectId)
            : {};
        const contextRefs = !saved
          ? key.startsWith('new:')
            ? await newDraftContext(projectId)
            : [
                ...new Map(
                  (await window.desktop.conversationContextSources(key))
                    .filter((source) => source.kind === 'instructions')
                    .map(
                      (source) =>
                        [
                          source.itemId ?? source.id,
                          { snapshotId: source.id, included: true },
                        ] as const,
                    ),
                ).values(),
              ]
          : saved.contextRefs;
        if (generation.current !== token) return;
        let next = saved ?? {
          ...fallback,
          ...defaults,
          attachments: [],
          contextRefs,
          mode: defaults.mode === 'code-bypass' ? 'code' : (defaults.mode ?? fallback.mode),
        };
        if (key.startsWith('new:') && next.mode === 'code-bypass') next = { ...next, mode: 'code' };
        cache.set(key, next);
        value.current = next;
        setValue(next);
        setReady(true);
        valueReady.current = true;
      })
      .catch((error) => {
        if (generation.current === token) {
          report(error);
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
  }, [key, contextReady, reload]);
  const update = (patch: Partial<Draft> | ((current: Draft) => Partial<Draft>)) => {
    if (!valueReady.current) {
      report(new Error('Load the draft and its configured context before making changes.'));
      return;
    }
    const contextKey = activeKey.current;
    const current = cache.get(contextKey) ?? value.current;
    const next = {
      ...current,
      ...(typeof patch === 'function' ? patch(current) : patch),
    };
    value.current = next;
    setValue(next);
    cache.set(contextKey, next);
    void persistDraft(contextKey, next).catch(report);
  };
  const replace = (contextKey: string, next: Draft) => {
    cache.set(contextKey, next);
    if (activeKey.current === contextKey) {
      ++generation.current;
      value.current = next;
      setValue(next);
      valueReady.current = true;
      setReady(true);
      setLoadError('');
    }
    return persistDraft(contextKey, next);
  };
  const discard = (contextKey: string) => {
    cache.delete(contextKey);
    return persistDraft(contextKey, null);
  };
  return {
    draft,
    ready,
    isReady: () => valueReady.current,
    loadError,
    retry: () => setReload((value) => value + 1),
    update,
    replace,
    discard,
    peek: (contextKey: string) => cache.get(contextKey),
  };
}

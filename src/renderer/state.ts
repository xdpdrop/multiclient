import { create } from 'zustand';
import type { Snapshot, ConversationView } from '../shared/types';
export function mergeConversation(
  current: ConversationView | null,
  incoming: ConversationView,
  earlier = false,
): ConversationView {
  if (!current || current.conversation.id !== incoming.conversation.id) return incoming;
  if (!earlier && incoming.cursor < current.cursor) return current;
  const messages = [
    ...new Map([...current.messages, ...incoming.messages].map((m) => [m.id, m])).values(),
  ].sort(
    (a, b) => (a.sequence ?? Date.parse(a.createdAt)) - (b.sequence ?? Date.parse(b.createdAt)),
  );
  const tools = [
    ...new Map(
      [...current.tools, ...incoming.tools].map((t) => [`${t.turnId}:${t.id}`, t]),
    ).values(),
  ];
  return {
    ...(earlier ? current : incoming),
    messages,
    tools,
    hasMore: earlier ? incoming.hasMore : current.hasMore,
    cursor: Math.max(current.cursor, incoming.cursor),
  };
}
type State = {
  snapshot: Snapshot | null;
  view: ConversationView | null;
  selectedId: string | null;
  anchorMessageId: string | null;
  projectId?: string;
  workspaceId?: string;
  error: string;
  settingsOpen: boolean;
  panel: 'files' | 'git' | null;
  terminal: boolean;
  loading: boolean;
  paging: boolean;
  runtimeStatus: 'ready' | 'recovering' | 'failed';
  refresh(): Promise<void>;
  select(id: string | null, messageId?: string): Promise<void>;
  loadEarlier(): Promise<void>;
  report(error: unknown): void;
  set(values: Partial<State>): void;
};
export const useApp = create<State>((set, get) => {
  let generation = 0;
  let refreshPromise: Promise<void> | null = null;
  let refreshAgain = false;
  return {
    snapshot: null,
    view: null,
    selectedId: null,
    anchorMessageId: null,
    error: '',
    settingsOpen: false,
    panel: null,
    terminal: false,
    loading: false,
    paging: false,
    runtimeStatus: 'ready',
    set,
    report: (error) =>
      set({
        error:
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
            : String(error),
      }),
    refresh: () => {
      refreshAgain = true;
      if (refreshPromise) return refreshPromise;
      refreshPromise = (async () => {
        while (refreshAgain) {
          refreshAgain = false;
          try {
            const snapshot = await window.desktop.snapshot();
            set({ snapshot });
            const id = get().selectedId;
            const token = generation;
            if (id && get().anchorMessageId && get().view) {
              const metadata = snapshot.conversations.find((c) => c.id === id);
              if (metadata)
                set({
                  view: {
                    ...get().view!,
                    conversation: { ...get().view!.conversation, ...metadata },
                  },
                });
            }
            if (id && !get().loading && !get().anchorMessageId) {
              const view = await window.desktop.conversation(id);
              if (generation === token) set({ view: mergeConversation(get().view, view) });
            }
          } catch (e) {
            get().report(e);
          }
        }
      })().finally(() => {
        refreshPromise = null;
      });
      return refreshPromise;
    },
    select: async (selectedId, messageId) => {
      const token = ++generation;
      set({
        selectedId,
        anchorMessageId: messageId ?? null,
        view: null,
        loading: !!selectedId,
        paging: false,
      });
      if (selectedId) {
        try {
          const view = messageId
            ? await window.desktop.conversationAround(selectedId, messageId)
            : await window.desktop.conversation(selectedId);
          if (generation === token)
            set({
              view,
              projectId: view.conversation.projectId ?? undefined,
              workspaceId: view.conversation.workspaceId ?? undefined,
            });
        } catch (e) {
          if (generation === token) get().report(e);
        } finally {
          if (generation === token) set({ loading: false });
        }
      }
    },
    loadEarlier: async () => {
      const { view, selectedId, paging, loading } = get();
      if (!view?.hasMore || !selectedId || paging || loading || !view.messages.length) return;
      const token = generation;
      set({ paging: true });
      try {
        const older = await window.desktop.conversation(selectedId, view.messages[0].id);
        if (generation === token) set({ view: mergeConversation(get().view, older, true) });
      } catch (e) {
        if (generation === token) get().report(e);
      } finally {
        if (generation === token) set({ paging: false });
      }
    },
  };
});

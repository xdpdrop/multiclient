import {
  CONTEXT_MAX_SOURCES,
  type ContextItem,
  type ContextRef,
  type ContextSnapshot,
  type SaveContextItem,
} from '../../shared/context';
import { memoryRoutes, type MemoryNote, type MemorySource } from '../../shared/memory';
import type { Store } from '../storage/store';

// The shared context store owns persistence, revisions, and immutable snapshots.
export type MemoryContextStore = {
  items(projectId: string | null, kind?: 'memory'): ContextItem[];
  item(id: string): ContextItem;
  save(input: SaveContextItem): ContextItem;
  remove(id: string, expectedRevision: number): void;
  snapshotItems(ids: string[]): ContextRef[];
  snapshot(id: string): ContextSnapshot;
};

function note(item: ContextItem): MemoryNote {
  const source =
    item.source?.conversationId && item.source.messageId
      ? { conversationId: item.source.conversationId, messageId: item.source.messageId }
      : undefined;
  return {
    id: item.id,
    revision: item.revision,
    projectId: item.projectId,
    title: item.title,
    text: item.text,
    includeNewChats: item.includeInNewChats,
    source,
    updatedAt: item.updatedAt,
  };
}

export function createMemoryHandlers(store: Pick<Store, 'db'>, context: MemoryContextStore) {
  const get = (id: string, expectedRevision?: number) => {
    const item = context.item(id);
    if (item.kind !== 'memory') throw new Error('This item is not a saved memory note.');
    if (expectedRevision !== undefined && item.revision !== expectedRevision)
      throw new Error('This memory note changed. Reload saved memory before trying again.');
    return item;
  };
  const validateSource = (source?: MemorySource) => {
    if (
      source &&
      !store.db
        .prepare('SELECT id FROM messages WHERE id=? AND conversation_id=?')
        .get(source.messageId, source.conversationId)
    )
      throw new Error(
        'The source message is unavailable. Save the note without a source reference.',
      );
  };
  const list = (projectId: string | null) => {
    const global = context
      .items(null, 'memory')
      .filter((item) => item.projectId === null && item.kind === 'memory');
    const project = projectId
      ? context
          .items(projectId, 'memory')
          .filter((item) => item.projectId === projectId && item.kind === 'memory')
      : [];
    return [...project, ...global];
  };
  const capture = (item: ContextItem): ContextSnapshot =>
    context.snapshot(context.snapshotItems([item.id])[0].snapshotId);
  return {
    memoryList(input: unknown) {
      const { projectId } = memoryRoutes.memoryList.parse(input);
      return list(projectId).map(note);
    },
    memorySave(input: unknown) {
      const value = memoryRoutes.memorySave.parse(input);
      if (value.id) {
        const previous = get(value.id, value.expectedRevision);
        if (previous.projectId !== value.projectId)
          throw new Error('Memory scope cannot change. Create a new note in the other scope.');
      }
      validateSource(value.source);
      return note(
        context.save({
          id: value.id,
          expectedRevision: value.expectedRevision,
          projectId: value.projectId,
          title: value.title,
          text: value.text,
          source: value.source,
          kind: 'memory',
          includeInNewChats: value.includeNewChats,
        }),
      );
    },
    memoryDelete(input: unknown) {
      const { id, expectedRevision } = memoryRoutes.memoryDelete.parse(input);
      get(id, expectedRevision);
      context.remove(id, expectedRevision);
    },
    memoryInclude(input: unknown) {
      const { id, expectedRevision, projectId } = memoryRoutes.memoryInclude.parse(input);
      const item = get(id, expectedRevision);
      if (item.projectId !== null && item.projectId !== projectId)
        throw new Error('This memory belongs to another project.');
      return capture(item);
    },
    memoryDefaults(input: unknown) {
      const { projectId } = memoryRoutes.memoryDefaults.parse(input);
      const items = list(projectId).filter((item) => item.includeInNewChats);
      if (items.length > CONTEXT_MAX_SOURCES)
        throw new Error(
          'Too many memory notes are enabled for new chats. Choose fewer notes in saved memory.',
        );
      return items.map(capture);
    },
  };
}

import type { Store } from '../storage/store';
import { contextRoutes, type ContextKind, type SaveContextItem } from '../../shared/context';
import { ContextStore } from './storage';

export function createContextHandlers(store: Store, changed: () => void = () => {}) {
  const context = new ContextStore(store);
  return {
    createChatProject(raw: unknown) {
      const input = contextRoutes.createChatProject.parse(raw);
      const project = store.createChatProject(input.name);
      changed();
      return project;
    },
    renameProject(raw: unknown) {
      const input = contextRoutes.renameProject.parse(raw);
      store.renameProject(input.id, input.name);
      changed();
    },
    contextItems(raw: unknown) {
      const input = contextRoutes.contextItems.parse(raw);
      return context
        .items(input.projectId, input.kind as ContextKind | undefined)
        .map(({ text, attachment: _attachment, ...item }) => ({
          ...item,
          characters: text.length,
        }));
    },
    contextItem(raw: unknown) {
      return context.item(contextRoutes.contextItem.parse(raw).id);
    },
    saveContextItem(raw: unknown) {
      const input = contextRoutes.saveContextItem.parse(raw) as SaveContextItem;
      const item = context.save(input);
      changed();
      return item;
    },
    removeContextItem(raw: unknown) {
      const input = contextRoutes.removeContextItem.parse(raw);
      context.remove(input.id, input.expectedRevision);
      changed();
    },
    contextSnapshot(raw: unknown) {
      return context.snapshot(contextRoutes.contextSnapshot.parse(raw).id);
    },
    contextSnapshots(raw: unknown) {
      return contextRoutes.contextSnapshots.parse(raw).ids.map((id) => context.snapshot(id));
    },
    snapshotContextItems(raw: unknown) {
      return context.snapshotItems(contextRoutes.snapshotContextItems.parse(raw).ids);
    },
    projectContextDefaults(raw: unknown) {
      return context.projectDefaults(contextRoutes.projectContextDefaults.parse(raw).projectId);
    },
    conversationContextSources(raw: unknown) {
      return context.conversationSources(contextRoutes.conversationContextSources.parse(raw).id);
    },
  };
}

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryHandlers, type MemoryContextStore } from '../../src/runtime/memory';
import { memorySaveSchema } from '../../src/shared/memory';
import type { ContextItem, ContextSnapshot } from '../../src/shared/context';
import type { Store } from '../../src/runtime/storage/store';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryLibrary } from '../../src/renderer/features/MemoryLibrary';
import { memoryApi } from '../../src/preload/features/memory';

function fixture() {
  const items = new Map<string, ContextItem>();
  const snapshots = new Map<string, ContextSnapshot>();
  const context: MemoryContextStore = {
    items: (projectId, kind) =>
      [...items.values()].filter(
        (item) => item.projectId === projectId && (!kind || item.kind === kind),
      ),
    item: (id) => {
      const item = items.get(id);
      if (!item) throw new Error('Item unavailable.');
      return item;
    },
    save: (input) => {
      const previous = input.id ? items.get(input.id) : undefined;
      if (previous && previous.revision !== input.expectedRevision) throw new Error('Stale item.');
      const item: ContextItem = {
        ...input,
        id: input.id ?? randomUUID(),
        revision: (previous?.revision ?? 0) + 1,
        includeInNewChats: input.includeInNewChats ?? false,
        updatedAt: new Date().toISOString(),
      };
      items.set(item.id, item);
      return item;
    },
    remove: (id) => {
      items.delete(id);
    },
    snapshotItems: (ids) =>
      ids.map((id) => {
        const item = context.item(id);
        let snapshot = [...snapshots.values()].find(
          (value) => value.itemId === id && value.revision === item.revision,
        );
        if (!snapshot) {
          snapshot = {
            id: randomUUID(),
            itemId: item.id,
            revision: item.revision,
            kind: item.kind,
            title: item.title,
            text: item.text,
            projectId: item.projectId,
            source: structuredClone(item.source),
            createdAt: new Date().toISOString(),
          };
          snapshots.set(snapshot.id, snapshot);
        }
        return { snapshotId: snapshot.id, included: true };
      }),
    snapshot: (id) => {
      const snapshot = snapshots.get(id);
      if (!snapshot) throw new Error('Snapshot unavailable.');
      return snapshot;
    },
  };
  const get = vi.fn().mockReturnValue(undefined);
  const store = { db: { prepare: vi.fn().mockReturnValue({ get }) } } as unknown as Pick<
    Store,
    'db'
  >;
  return { handlers: createMemoryHandlers(store, context), items, snapshots, get };
}

describe('manually saved memory', () => {
  it('defaults to explicit sharing and only combines global with the current project', () => {
    const { handlers } = fixture();
    const projectId = randomUUID();
    const otherProject = randomUUID();
    const global = handlers.memorySave({
      projectId: null,
      title: 'Preference',
      text: 'Use concise answers.',
    });
    const local = handlers.memorySave({ projectId, title: 'Decision', text: 'Ship on Windows.' });
    handlers.memorySave({ projectId: otherProject, title: 'Private', text: 'Other customer.' });
    expect(global.includeNewChats).toBe(false);
    expect(handlers.memoryDefaults({ projectId })).toEqual([]);
    expect(handlers.memoryList({ projectId }).map((note) => note.id)).toEqual([
      local.id,
      global.id,
    ]);
    expect(handlers.memoryList({ projectId: null }).map((note) => note.id)).toEqual([global.id]);
    expect(() =>
      handlers.memoryInclude({ id: local.id, expectedRevision: 1, projectId: otherProject }),
    ).toThrow('another project');
  });

  it('pins immutable copies and retains shared snapshots after editing and deletion', () => {
    const { handlers, snapshots } = fixture();
    const saved = handlers.memorySave({
      projectId: null,
      title: 'Preference',
      text: 'Original',
      includeNewChats: true,
    });
    const snapshot = handlers.memoryDefaults({ projectId: null })[0];
    expect(handlers.memoryDefaults({ projectId: null })[0].id).toBe(snapshot.id);
    const edited = handlers.memorySave({
      id: saved.id,
      expectedRevision: saved.revision,
      projectId: null,
      title: 'Preference',
      text: 'Updated',
    });
    expect(edited.revision).toBe(2);
    handlers.memoryDelete({ id: saved.id, expectedRevision: 2 });
    expect(handlers.memoryList({ projectId: null })).toEqual([]);
    expect(snapshots.get(snapshot.id)?.text).toBe('Original');
  });

  it('rejects stale edits, inclusion, deletes and implicit scope moves before mutation', () => {
    const { handlers } = fixture();
    const saved = handlers.memorySave({ projectId: null, title: 'Note', text: 'Original' });
    handlers.memorySave({
      id: saved.id,
      expectedRevision: 1,
      projectId: null,
      title: 'Note',
      text: 'Updated',
    });
    expect(() =>
      handlers.memorySave({
        id: saved.id,
        expectedRevision: 1,
        projectId: null,
        title: 'Note',
        text: 'Lost update',
      }),
    ).toThrow('changed');
    expect(() => handlers.memoryDelete({ id: saved.id, expectedRevision: 1 })).toThrow('changed');
    expect(() =>
      handlers.memoryInclude({ id: saved.id, expectedRevision: 1, projectId: null }),
    ).toThrow('changed');
    expect(() =>
      handlers.memorySave({
        id: saved.id,
        expectedRevision: 2,
        projectId: randomUUID(),
        title: 'Note',
        text: 'Moved',
      }),
    ).toThrow('scope');
    expect(handlers.memoryList({ projectId: null })[0].text).toBe('Updated');
  });

  it('cannot mutate other context kinds or manufacture message provenance', () => {
    const { handlers, items, get } = fixture();
    const note = handlers.memorySave({ projectId: null, title: 'Note', text: 'Text' });
    items.set(note.id, { ...items.get(note.id)!, kind: 'instructions' });
    expect(() => handlers.memoryDelete({ id: note.id, expectedRevision: 1 })).toThrow(
      'not a saved memory',
    );
    const source = { conversationId: randomUUID(), messageId: randomUUID() };
    expect(() =>
      handlers.memorySave({ projectId: null, title: 'Source', text: 'Text', source }),
    ).toThrow('source message');
    get.mockReturnValue({ id: source.messageId });
    expect(
      handlers.memorySave({ projectId: null, title: 'Source', text: 'Text', source }).source,
    ).toEqual(source);
  });

  it('requires revision-aware edits and rejects empty, oversized or extra input', () => {
    const base = { projectId: null, title: 'Note', text: 'Text' };
    expect(memorySaveSchema.parse(base).includeNewChats).toBe(false);
    expect(memorySaveSchema.safeParse({ ...base, id: randomUUID() }).success).toBe(false);
    expect(memorySaveSchema.safeParse({ ...base, text: ' '.repeat(10) }).success).toBe(false);
    expect(memorySaveSchema.safeParse({ ...base, text: 'x'.repeat(10001) }).success).toBe(false);
    expect(memorySaveSchema.safeParse({ ...base, automatic: true }).success).toBe(false);
  });

  it('does not silently truncate excessive opted-in memory or create partial snapshots', () => {
    const { handlers, snapshots } = fixture();
    for (let index = 0; index < 31; index++)
      handlers.memorySave({
        projectId: null,
        title: `Note ${index}`,
        text: 'Text',
        includeNewChats: true,
      });
    expect(() => handlers.memoryDefaults({ projectId: null })).toThrow('Too many memory notes');
    expect(snapshots.size).toBe(0);
  });

  it('exposes sharing and retention clearly and escapes saved message selections', () => {
    const markup = renderToStaticMarkup(
      createElement(MemoryLibrary, {
        api: memoryApi(vi.fn()),
        projectId: null,
        onClose: vi.fn(),
        onInclude: vi.fn(),
        onFreshChat: vi.fn(),
        initialNote: { text: '<script>unexpected()</script>' },
      }),
    );
    expect(markup).toContain('Nothing is inferred or saved automatically');
    expect(markup).toContain('native provider sessions retain');
    expect(markup).toContain('Start fresh without memory');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('checked=""');
    expect(markup).toContain('Memory scope');
  });

  it('keeps named preload operations explicit and revision-aware', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = memoryApi(invoke);
    const id = randomUUID();
    await api.memoryInclude(id, 3, null);
    await api.memoryDelete(id, 3);
    expect(invoke.mock.calls).toEqual([
      ['memoryInclude', { id, expectedRevision: 3, projectId: null }],
      ['memoryDelete', { id, expectedRevision: 3 }],
    ]);
  });
});

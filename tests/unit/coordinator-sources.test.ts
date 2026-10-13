import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Coordinator } from '../../src/runtime/conversations/coordinator';
import type { ContextSnapshot } from '../../src/shared/context';
import type { Message } from '../../src/shared/types';
import type { Store } from '../../src/runtime/storage/store';
import { capabilities } from '../../src/shared/defaults';

const provider = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('../../src/runtime/providers', () => ({ connect: provider.connect }));
vi.mock('../../src/runtime/providers/process', () => ({
  findExecutable: async () => 'fixture-provider.exe',
  version: async () => 'codex-cli 0.158.0',
}));
beforeEach(() => {
  vi.clearAllMocks();
});

function source(
  kind: ContextSnapshot['kind'],
  text: string,
  projectId: string | null = null,
): ContextSnapshot {
  return {
    id: randomUUID(),
    itemId: randomUUID(),
    revision: 1,
    kind,
    title: `${kind} source`,
    text,
    projectId,
    createdAt: new Date().toISOString(),
  };
}
function message(sources: ContextSnapshot[]): Message {
  return {
    id: randomUUID(),
    conversationId: 'chat',
    sessionId: 'session',
    turnId: 'turn',
    role: 'user',
    text: 'Previous prompt',
    status: 'sent',
    providerId: 'demo',
    createdAt: new Date().toISOString(),
    contextSources: sources,
  };
}
function fixture(
  sources: ContextSnapshot[],
  historical: ContextSnapshot[] = [],
  projectId: string | null = null,
) {
  const snapshots = new Map(sources.map((snapshot) => [snapshot.id, snapshot]));
  const revisions = new Map(sources.map((snapshot) => [snapshot.itemId, snapshot.revision]));
  const prepare = vi.fn((sql: string) => {
    if (sql === 'SELECT content FROM context_snapshots WHERE id=?')
      return {
        get: (id: string) =>
          snapshots.has(id) ? { content: JSON.stringify(snapshots.get(id)) } : undefined,
      };
    if (sql === 'SELECT revision FROM context_items WHERE id=?')
      return {
        get: (id: string) => (revisions.has(id) ? { revision: revisions.get(id) } : undefined),
      };
    if (sql.includes("b.type='context-sources-v1'"))
      return {
        all: () => historical.map((snapshot) => ({ id: snapshot.id })),
      };
    throw new Error(`Unexpected source query: ${sql}`);
  });
  const store = {
    db: { prepare },
    conversation: () => ({ id: 'chat', projectId }),
  } as unknown as Store;
  return {
    store,
    coordinator: new Coordinator(
      store,
      '',
      '',
      () => {},
      async () => undefined,
    ),
    prepare,
    revisions,
  };
}

describe('coordinator source resolution', () => {
  it('keeps inherited project instructions separate from optional source text', () => {
    const instructions = source('instructions', 'Use the approved terminology.');
    const memory = source('memory', 'Private saved preference.');
    const { coordinator } = fixture([instructions, memory], [instructions, memory]);
    const result = coordinator.resolveContext({ conversationId: 'chat' }, [
      message([instructions, memory]),
    ]);
    expect(result.contextSources.map((value) => value.id)).toEqual([instructions.id]);
    expect(result.instructionsText).toContain(instructions.text);
    expect(result.contextText).toBe('');
  });

  it('honors explicit exclusion and never silently inherits deselected sources', () => {
    const instructions = source('instructions', 'Project rules.');
    const memory = source('memory', 'Saved private fact.');
    const { coordinator } = fixture([instructions, memory], [instructions, memory]);
    const selected = coordinator.resolveContext(
      {
        conversationId: 'chat',
        contextRefs: [
          { snapshotId: instructions.id, included: true },
          { snapshotId: memory.id, included: true },
        ],
        excludedContextSnapshotIds: [memory.id],
      },
      [message([instructions, memory])],
    );
    expect(selected.contextSources.map((value) => value.id)).toEqual([instructions.id]);
    expect(selected.contextText).not.toContain(memory.text);
    const empty = coordinator.resolveContext({ conversationId: 'chat', contextRefs: [] }, [
      message([instructions]),
    ]);
    expect(empty.instructionsText).toBe('');
  });

  it('requires review when a new library selection changed and retains historical captures', () => {
    const memory = source('memory', 'Original capture.');
    const { coordinator, revisions } = fixture([memory]);
    revisions.set(memory.itemId, 2);
    expect(() =>
      coordinator.resolveContext(
        { conversationId: 'chat', contextRefs: [{ snapshotId: memory.id, included: true }] },
        [],
      ),
    ).toThrow('changed or was removed');
    const reviewed = coordinator.resolveContext(
      {
        conversationId: 'chat',
        contextRefs: [{ snapshotId: memory.id, included: true, reviewed: true }],
      },
      [],
    );
    expect(reviewed.contextText).toContain('Original capture.');
    const history = fixture([memory], [memory]);
    history.revisions.delete(memory.itemId);
    expect(
      history.coordinator.resolveContext(
        { conversationId: 'chat', contextRefs: [{ snapshotId: memory.id, included: true }] },
        [message([memory])],
      ).contextText,
    ).toContain('Original capture.');
  });

  it('rejects foreign project source references even when the capture was marked reviewed', () => {
    const privateSource = source('memory', 'Another project secret.', randomUUID());
    const { coordinator } = fixture([privateSource], [], randomUUID());
    expect(() =>
      coordinator.resolveContext(
        {
          conversationId: 'chat',
          contextRefs: [{ snapshotId: privateSource.id, included: true, reviewed: true }],
        },
        [],
      ),
    ).toThrow('another project');
  });

  it('does not resolve a stale library snapshot that the user explicitly excluded', () => {
    const memory = source('memory', 'Deleted note.');
    const { coordinator, revisions } = fixture([memory]);
    revisions.delete(memory.itemId);
    const result = coordinator.resolveContext(
      {
        conversationId: 'chat',
        contextRefs: [{ snapshotId: memory.id, included: true }],
        excludedContextSnapshotIds: [memory.id],
      },
      [],
    );
    expect(result.contextSources).toEqual([]);
    expect(result.contextText).toBe('');
  });

  it('performs no database source or artifact lookup for ordinary source-free turns', () => {
    const { coordinator, prepare } = fixture([]);
    expect(coordinator.resolveContext({ conversationId: 'chat' }, [])).toEqual({
      contextText: '',
      instructionsText: '',
      contextSources: [],
      artifactText: '',
    });
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('native project instruction continuity', () => {
  function nativeFixture() {
    const instructions = source('instructions', 'Original project policy.');
    const changed = {
      ...instructions,
      id: randomUUID(),
      revision: 2,
      text: 'Updated project policy.',
    };
    const base = fixture([instructions, changed], [instructions]);
    const previousUser = message([instructions]);
    const connection = {
      capabilities: capabilities('codex'),
      openSession: vi.fn(async () => ({})),
      startTurn: vi.fn(async () => {}),
      cancelTurn: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    provider.connect.mockResolvedValue(connection);
    const store = {
      db: base.store.db,
      conversation: () => ({ id: 'chat', projectId: null, workspaceId: null, archived: false }),
      connection: () => ({
        id: 'codex',
        enabled: true,
        kind: 'cli-agent',
        model: '',
        executable: '',
      }),
      turnByRequest: () => undefined,
      configurationRevision: () => 'revision',
      lastSession: () => ({
        id: 'previous-session',
        providerId: 'codex',
        model: '',
        mode: 'ask',
        configurationRevision: 'revision',
        nativeId: 'old-native-session',
      }),
      messages: () => [previousUser],
      transcript: (sessionId: string) => (sessionId === 'previous-session' ? [previousUser] : []),
      session: vi.fn(() => ({ id: 'fresh-session', nativeId: null })),
      startTurn: vi.fn(() => ({
        turn: {
          id: 'turn',
          conversationId: 'chat',
          sessionId: 'fresh-session',
          status: 'starting',
        },
        assistantId: 'assistant',
        userId: 'user',
      })),
      cursor: () => 0,
      event: vi.fn(),
      finish: vi.fn(),
    };
    return {
      instructions,
      changed,
      store,
      connection,
      coordinator: new Coordinator(
        store as unknown as Store,
        '',
        '',
        () => {},
        async () => undefined,
      ),
      input: {
        conversationId: 'chat',
        requestId: 'request',
        providerId: 'codex' as const,
        text: 'Continue',
        model: '',
        mode: 'ask',
        attachments: [],
      },
    };
  }

  it.each(['changed', 'disabled'] as const)(
    'rejects %s instructions before resuming native inference',
    async (change) => {
      const { coordinator, input, changed, store } = nativeFixture();
      const contextRefs = change === 'changed' ? [{ snapshotId: changed.id, included: true }] : [];
      await expect(coordinator.send({ ...input, contextRefs })).rejects.toThrow(
        'original project instructions',
      );
      expect(store.startTurn).not.toHaveBeenCalled();
      expect(provider.connect).not.toHaveBeenCalled();
      await coordinator.close();
    },
  );

  it('starts a fresh native session after an explicit reviewed handoff changes instructions', async () => {
    const { coordinator, input, changed, store, connection } = nativeFixture();
    try {
      await coordinator.send({
        ...input,
        handoff: 'Reviewed context with updated instructions.',
        contextRefs: [{ snapshotId: changed.id, included: true }],
      });
      expect(store.session).toHaveBeenCalledWith('chat', 'codex', '', 'ask', 'revision', true);
      await expect.poll(() => connection.startTurn.mock.calls.length).toBe(1);
    } finally {
      await coordinator.close();
    }
  });
});

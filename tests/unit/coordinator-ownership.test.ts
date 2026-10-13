import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Coordinator } from '../../src/runtime/conversations/coordinator';
import type { Store } from '../../src/runtime/storage/store';
import { capabilities } from '../../src/shared/defaults';
import { emptyContextDb } from './fixtures/coordinator-db';

const fixture = vi.hoisted(() => ({ ownership: vi.fn() }));
vi.mock('../../src/runtime/files/ownership', () => ({ checkoutOwnership: fixture.ownership }));
vi.mock('../../src/runtime/providers/process', () => ({
  findExecutable: async () => 'official-provider.exe',
  version: async () => 'codex-cli 0.158.0',
}));
vi.mock('../../src/runtime/providers', () => ({
  connect: async () => {
    let finish: () => void = () => {};
    return {
      capabilities: capabilities('codex'),
      openSession: async () => ({}),
      startTurn: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      cancelTurn: async () => finish(),
      close: async () => finish(),
    };
  },
}));
function setup() {
  const paths: Record<string, string> = {
    root: 'shared-root',
    nested: 'shared-root/nested',
    isolated: 'isolated-worktree',
  };
  const store = {
    db: emptyContextDb(),
    messages: () => [],
    conversation: (id: string) => ({
      id,
      archived: false,
      projectId: `project-${id}`,
      workspaceId: id,
    }),
    workspace: (id: string) => ({
      id,
      projectId: `project-${id}`,
      path: paths[id],
      trusted: true,
      archived: false,
    }),
    turnByRequest: () => undefined,
    connection: () => ({
      id: 'codex',
      kind: 'cli-agent',
      enabled: true,
      model: '',
      executable: '',
    }),
    configurationRevision: () => 'revision',
    lastSession: () => undefined,
    session: (id: string) => ({ id: `session-${id}`, nativeId: null }),
    startTurn: vi.fn((id: string) => ({
      turn: {
        id: `turn-${id}`,
        conversationId: id,
        sessionId: `session-${id}`,
        status: 'starting',
      },
      assistantId: `assistant-${id}`,
      userId: `user-${id}`,
    })),
    cursor: () => 0,
    transcript: () => [],
    finish: vi.fn(),
    event: vi.fn(),
  };
  const coordinator = new Coordinator(
    store as unknown as Store,
    '',
    '',
    () => {},
    async () => undefined,
  );
  const input = (id: string) => ({
    conversationId: id,
    requestId: `request-${id}`,
    providerId: 'codex' as const,
    model: '',
    mode: 'ask',
    text: 'Inspect checkout',
    attachments: [],
  });
  return { coordinator, store, input };
}
beforeEach(() => {
  fixture.ownership.mockReset();
  fixture.ownership.mockImplementation(async (path: string) =>
    path.startsWith('shared-root') ? 'same-checkout' : path,
  );
});
describe('one active agent per physical checkout', () => {
  it('serializes simultaneous requests from root and nested project registrations', async () => {
    const { coordinator, store, input } = setup();
    try {
      const outcomes = await Promise.allSettled([
        coordinator.send(input('root')),
        coordinator.send(input('nested')),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find(
        (outcome) => outcome.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason.message).toMatch(/running in this checkout/);
      expect(store.startTurn).toHaveBeenCalledTimes(1);
    } finally {
      await coordinator.close();
    }
  });
  it('allows a distinct managed worktree to run concurrently', async () => {
    const { coordinator, store, input } = setup();
    try {
      await coordinator.send(input('root'));
      await coordinator.send(input('isolated'));
      expect(store.startTurn).toHaveBeenCalledTimes(2);
      expect(coordinator.activeTurns()).toHaveLength(2);
    } finally {
      await coordinator.close();
    }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Coordinator } from '../../src/runtime/conversations/coordinator';
import type { Store } from '../../src/runtime/storage/store';
import { capabilities } from '../../src/shared/defaults';
import { emptyContextDb } from './fixtures/coordinator-db';

const provider = vi.hoisted(() => ({
  findExecutable: vi.fn(),
  version: vi.fn(),
  connect: vi.fn(),
}));
vi.mock('../../src/runtime/providers/process', () => ({
  findExecutable: provider.findExecutable,
  version: provider.version,
}));
vi.mock('../../src/runtime/providers', () => ({ connect: provider.connect }));
vi.mock('../../src/runtime/files/ownership', () => ({
  checkoutOwnership: async () => 'physical-worktree',
}));

const input = {
  conversationId: 'chat',
  requestId: 'request',
  providerId: 'codex' as const,
  text: 'Inspect this checkout',
  model: '',
  mode: 'ask',
  attachments: [],
};
function setup() {
  const workspace = {
    id: 'worktree',
    projectId: 'project',
    path: 'isolated-checkout',
    trusted: true,
    archived: false,
  };
  const connection = {
    capabilities: capabilities('codex'),
    openSession: vi.fn(async () => ({})),
    startTurn: vi.fn(async () => {}),
    cancelTurn: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  provider.connect.mockResolvedValue(connection);
  const store = {
    db: emptyContextDb(),
    messages: () => [],
    workspace: vi.fn(() => ({ ...workspace })),
    project: vi.fn(() => ({ id: 'project', path: 'source-checkout', trusted: false })),
    conversation: () => ({
      id: 'chat',
      projectId: 'project',
      workspaceId: 'worktree',
      archived: false,
    }),
    turnByRequest: () => undefined,
    connection: () => ({
      id: 'codex',
      enabled: true,
      kind: 'cli-agent',
      model: '',
      executable: '',
    }),
    configurationRevision: () => 'revision',
    lastSession: () => undefined,
    session: () => ({ id: 'session', nativeId: null }),
    startTurn: vi.fn(() => ({
      turn: { id: 'turn', conversationId: 'chat', sessionId: 'session', status: 'starting' },
      assistantId: 'assistant',
      userId: 'user',
    })),
    event: vi.fn(),
    cursor: () => 0,
    transcript: () => [],
    finish: vi.fn(),
  };
  return {
    store,
    workspace,
    connection,
    coordinator: new Coordinator(
      store as unknown as Store,
      '',
      '',
      () => {},
      async () => undefined,
    ),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  provider.findExecutable.mockResolvedValue('official-provider.exe');
  provider.version.mockResolvedValue('codex-cli 0.158.0');
});
describe('conversation workspace isolation', () => {
  it('uses the exact trusted worktree for executable containment and provider cwd', async () => {
    const { coordinator, store, workspace } = setup();
    await coordinator.send(input);
    await expect.poll(() => provider.connect.mock.calls.length).toBe(1);
    expect(provider.findExecutable).toHaveBeenCalledWith('codex', '', workspace.path);
    expect(provider.connect.mock.calls[0][0].cwd).toBe(workspace.path);
    expect(store.project).not.toHaveBeenCalled();
    await coordinator.close();
  });
  it('refuses an archived workspace before starting a turn', async () => {
    const { coordinator, store, workspace } = setup();
    workspace.archived = true;
    await expect(coordinator.send(input)).rejects.toThrow(/workspace is archived/);
    expect(store.startTurn).not.toHaveBeenCalled();
    expect(provider.findExecutable).not.toHaveBeenCalled();
  });
  it('does not start inference if cancellation arrives while opening the native session', async () => {
    const { coordinator, connection } = setup();
    let finishOpen: () => void = () => {};
    connection.openSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOpen = () => resolve({});
        }),
    );
    await coordinator.send(input);
    await expect.poll(() => connection.openSession.mock.calls.length).toBe(1);
    const cancelled = coordinator.cancel('chat');
    finishOpen();
    await cancelled;
    expect(connection.startTurn).not.toHaveBeenCalled();
  });
  it.each(['trust', 'archive', 'path'] as const)(
    'rechecks %s after asynchronous version discovery',
    async (change) => {
      const { coordinator, store, workspace } = setup();
      provider.version.mockImplementationOnce(async () => {
        if (change === 'trust') workspace.trusted = false;
        if (change === 'archive') workspace.archived = true;
        if (change === 'path') workspace.path = 'different-checkout';
        return 'codex-cli 0.158.0';
      });
      await expect(coordinator.send(input)).rejects.toThrow(/workspace|Workspace/);
      expect(store.startTurn).not.toHaveBeenCalled();
      expect(provider.connect).not.toHaveBeenCalled();
    },
  );
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Coordinator } from '../../src/runtime/conversations/coordinator';
import type { Message, SendInput } from '../../src/shared/types';
import type { Store } from '../../src/runtime/storage/store';
import { capabilities } from '../../src/shared/defaults';
import { emptyContextDb } from './fixtures/coordinator-db';

const provider = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('../../src/runtime/providers', () => ({ connect: provider.connect }));
let directory: string;
const coordinators: Coordinator[] = [];
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), 'multiclient-selected-context-'));
});
afterEach(async () => {
  for (const coordinator of coordinators.splice(0)) await coordinator.close();
  await rm(directory, { recursive: true, force: true });
});
function setup() {
  const oldUser = {
    id: 'past-user',
    conversationId: 'chat',
    sessionId: 'current-session',
    turnId: 'past-turn',
    role: 'user',
    text: 'Past prompt',
    status: 'sent',
  };
  const oldAssistant = {
    id: 'past-assistant',
    conversationId: 'chat',
    sessionId: 'earlier-provider-session',
    turnId: 'past-turn',
    role: 'assistant',
    text: 'Earlier provider answer',
    context: 'Shared context',
    status: 'completed',
  };
  const messages = [oldUser, oldAssistant] as Message[];
  const connection = {
    capabilities: capabilities('compatible'),
    openSession: vi.fn(async () => ({})),
    startTurn: vi.fn(async (_request: unknown) => {}),
    cancelTurn: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  provider.connect.mockResolvedValue(connection);
  const store = {
    db: emptyContextDb(),
    messages: () => messages,
    turnByRequest: () => undefined,
    conversation: () => ({ id: 'chat', archived: false, projectId: null, workspaceId: null }),
    connection: () => ({
      id: 'compatible',
      enabled: true,
      kind: 'api-chat',
      model: 'fixture-model',
    }),
    configurationRevision: () => 'revision',
    lastSession: () => undefined,
    session: () => ({ id: 'current-session', nativeId: null }),
    startTurn: vi.fn(() => {
      messages.push({
        id: 'current-user',
        conversationId: 'chat',
        sessionId: 'current-session',
        turnId: 'current-turn',
        role: 'user',
        text: 'Current prompt',
        status: 'sent',
      } as Message);
      messages.push({
        id: 'current-assistant',
        conversationId: 'chat',
        sessionId: 'current-session',
        turnId: 'current-turn',
        role: 'assistant',
        text: '',
        status: 'streaming',
      } as Message);
      return {
        turn: {
          id: 'current-turn',
          conversationId: 'chat',
          sessionId: 'current-session',
          status: 'starting',
        },
        assistantId: 'current-assistant',
        userId: 'current-user',
      };
    }),
    transcript: () =>
      messages.filter(
        (message) => message.sessionId === 'current-session' && message.status !== 'streaming',
      ),
    cursor: () => 0,
    event: vi.fn(),
    finish: vi.fn(),
  };
  const coordinator = new Coordinator(
    store as unknown as Store,
    directory,
    '',
    () => {},
    async () => undefined,
  );
  coordinators.push(coordinator);
  const input: SendInput = {
    conversationId: 'chat',
    requestId: 'request',
    providerId: 'compatible',
    model: 'fixture-model',
    mode: 'chat',
    text: 'Current prompt',
    attachments: [],
  };
  return { coordinator, store, connection, input };
}
describe('explicit API conversation history selection', () => {
  it('rejects IDs from another conversation before persisting or dispatching a turn', async () => {
    const { coordinator, store, input } = setup();
    await expect(
      coordinator.send({ ...input, historyMessageIds: ['foreign-message'] }),
    ).rejects.toThrow(/belong to this conversation/);
    expect(store.startTurn).not.toHaveBeenCalled();
    expect(provider.connect).not.toHaveBeenCalled();
  });
  it('keeps the current prompt when the user explicitly chooses no past messages', async () => {
    const { coordinator, store, connection, input } = setup();
    await coordinator.send({ ...input, historyMessageIds: [] });
    await expect.poll(() => connection.startTurn.mock.calls.length).toBe(1);
    const request = connection.startTurn.mock.calls[0][0] as { history: Message[]; text: string };
    expect(request.history.map((message) => message.id)).toEqual(['current-user']);
    expect(request.text).toBe('Current prompt');
    expect(store.event).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'current-turn' }),
      'context-selection',
      { messageIds: [] },
    );
  });
  it('includes explicitly selected earlier-provider output in saved chronological order', async () => {
    const { coordinator, connection, input } = setup();
    await coordinator.send({ ...input, historyMessageIds: ['past-assistant'] });
    await expect.poll(() => connection.startTurn.mock.calls.length).toBe(1);
    const request = connection.startTurn.mock.calls[0][0] as { history: Message[] };
    expect(request.history.map((message) => message.id)).toEqual([
      'past-assistant',
      'current-user',
    ]);
    expect(request.history[0].context).toBe('Shared context');
  });
  it('preserves default current-session history when selection is absent', async () => {
    const { coordinator, store, connection, input } = setup();
    await coordinator.send(input);
    await expect.poll(() => connection.startTurn.mock.calls.length).toBe(1);
    const request = connection.startTurn.mock.calls[0][0] as { history: Message[] };
    expect(request.history.map((message) => message.id)).toEqual(['past-user', 'current-user']);
    expect(store.event.mock.calls.some((call) => call[1] === 'context-selection')).toBe(false);
  });
});

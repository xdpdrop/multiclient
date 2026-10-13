import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationView, Message } from '../../src/shared/types';

let useApp: typeof import('../../src/renderer/state').useApp;
let mergeConversation: typeof import('../../src/renderer/state').mergeConversation;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function message(conversationId: string, sequence: number, text = `message ${sequence}`): Message {
  return {
    id: `${conversationId}-${sequence}`,
    sequence,
    conversationId,
    sessionId: 'session',
    turnId: `turn-${sequence}`,
    role: 'assistant',
    text,
    status: 'completed',
    providerId: 'demo',
    createdAt: new Date(sequence * 1000).toISOString(),
  };
}
function view(id: string, sequences: number[], cursor = 1, hasMore = false): ConversationView {
  return {
    conversation: {
      id,
      projectId: null,
      workspaceId: null,
      title: id,
      providerId: 'demo',
      model: '',
      mode: 'chat',
      effort: '',
      updatedAt: new Date().toISOString(),
      archived: false,
    },
    messages: sequences.map((sequence) => message(id, sequence)),
    tools: [],
    interactions: [],
    cursor,
    hasMore,
  };
}

beforeEach(async () => {
  vi.resetModules();
  ({ useApp, mergeConversation } = await import('../../src/renderer/state'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('transcript merging', () => {
  it('preserves older loaded pages while replacing updated messages and deduplicating tools', () => {
    const current = view('A', [1, 2, 3], 5, false);
    current.tools = [
      { turnId: 'turn-3', id: 'read', title: 'Read', detail: '', status: 'running' },
    ];
    const incoming = view('A', [3, 4], 6, true);
    incoming.messages[0].text = 'updated response';
    incoming.tools = [{ ...current.tools[0], status: 'completed' }];
    const result = mergeConversation(current, incoming);
    expect(result.messages.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
    expect(result.messages[2].text).toBe('updated response');
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].status).toBe('completed');
    expect(result.hasMore).toBe(false);
    expect(mergeConversation(result, view('A', [4], 2))).toBe(result);
  });
  it('prepends pages in sequence order without replacing live metadata', () => {
    const current = view('A', [3, 4], 8, true);
    current.interactions = [
      {
        id: 'pending',
        conversationId: 'A',
        sessionId: 'session',
        turnId: 'turn-4',
        kind: 'question',
        title: 'Answer',
        detail: '',
        status: 'pending',
      },
    ];
    const result = mergeConversation(current, view('A', [1, 2], 6, false), true);
    expect(result.messages.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBe(8);
    expect(result.interactions).toEqual(current.interactions);
  });
});

describe('conversation request identity', () => {
  it('rejects delayed A responses after A→B→A even though selected ID matches again', async () => {
    const first = deferred<ConversationView>();
    const middle = deferred<ConversationView>();
    const last = deferred<ConversationView>();
    const conversation = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(middle.promise)
      .mockReturnValueOnce(last.promise);
    vi.stubGlobal('window', { desktop: { conversation } });
    const firstSelection = useApp.getState().select('A');
    const middleSelection = useApp.getState().select('B');
    const lastSelection = useApp.getState().select('A');
    last.resolve(view('A', [3], 3));
    await lastSelection;
    middle.resolve(view('B', [2], 2));
    await middleSelection;
    first.resolve(view('A', [1], 1));
    await firstSelection;
    expect(useApp.getState().view?.messages[0].sequence).toBe(3);
    expect(useApp.getState().loading).toBe(false);
  });
  it('suppresses stale selection failures and loads a requested message window', async () => {
    const first = deferred<ConversationView>();
    const conversation = vi.fn().mockReturnValue(first.promise);
    const conversationAround = vi.fn().mockResolvedValue(view('B', [12, 13]));
    vi.stubGlobal('window', { desktop: { conversation, conversationAround } });
    const old = useApp.getState().select('A');
    await useApp.getState().select('B', 'B-12');
    first.reject(new Error('old error'));
    await old;
    expect(conversationAround).toHaveBeenCalledWith('B', 'B-12');
    expect(useApp.getState().view?.conversation.id).toBe('B');
    expect(useApp.getState().error).toBe('');
  });
  it('serializes earlier-page requests and ignores a page after changing conversation', async () => {
    const older = deferred<ConversationView>();
    const conversation = vi
      .fn()
      .mockResolvedValueOnce(view('A', [101, 102], 1, true))
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(view('B', [1]));
    vi.stubGlobal('window', { desktop: { conversation } });
    await useApp.getState().select('A');
    const page = useApp.getState().loadEarlier();
    await useApp.getState().loadEarlier();
    expect(conversation).toHaveBeenCalledTimes(2);
    expect(conversation).toHaveBeenLastCalledWith('A', 'A-101');
    await useApp.getState().select('B');
    older.resolve(view('A', [99, 100], 1, true));
    await page;
    expect(useApp.getState().view?.conversation.id).toBe('B');
    expect(useApp.getState().paging).toBe(false);
  });
});

it('coalesces refreshes and preserves older pages through the final fresh snapshot', async () => {
  const first = deferred<unknown>();
  const snapshot = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue({ marker: 'latest' });
  const conversation = vi
    .fn()
    .mockResolvedValueOnce(view('A', [2, 3], 2, true))
    .mockResolvedValueOnce(view('A', [3, 4], 3, true));
  vi.stubGlobal('window', { desktop: { snapshot, conversation } });
  useApp.setState({ selectedId: 'A', view: view('A', [1, 2], 1, false) });
  const one = useApp.getState().refresh();
  const two = useApp.getState().refresh();
  const three = useApp.getState().refresh();
  expect(one).toBe(two);
  expect(one).toBe(three);
  first.resolve({ marker: 'first' });
  await one;
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(conversation).toHaveBeenCalledTimes(2);
  expect(useApp.getState().view?.messages.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
  expect(useApp.getState().view?.hasMore).toBe(false);
  expect(useApp.getState().snapshot).toEqual({ marker: 'latest' });
});

it('discards a pending refresh when selection returns to the same chat under a new generation', async () => {
  const oldRefresh = deferred<ConversationView>();
  const conversation = vi
    .fn()
    .mockResolvedValueOnce(view('A', [1], 1))
    .mockReturnValueOnce(oldRefresh.promise)
    .mockResolvedValueOnce(view('B', [2], 2))
    .mockResolvedValueOnce(view('A', [4], 4));
  vi.stubGlobal('window', { desktop: { snapshot: vi.fn().mockResolvedValue({}), conversation } });
  await useApp.getState().select('A');
  const refresh = useApp.getState().refresh();
  await vi.waitFor(() => expect(conversation).toHaveBeenCalledTimes(2));
  await useApp.getState().select('B');
  await useApp.getState().select('A');
  oldRefresh.resolve(view('A', [3], 3));
  await refresh;
  expect(useApp.getState().view?.messages[0].sequence).toBe(4);
});

it('keeps an anchored search window separate from latest pages until normal selection resumes', async () => {
  const conversationAround = vi.fn().mockResolvedValue(view('A', [10, 11, 12], 8, true));
  const conversation = vi.fn().mockResolvedValue(view('A', [110, 111, 112], 10, true));
  const snapshot = vi.fn().mockResolvedValue({
    conversations: [
      { ...view('A', []).conversation, pinned: true, title: 'Renamed while searching' },
    ],
    activeTurns: [{ conversationId: 'A', status: 'waiting' }],
  });
  vi.stubGlobal('window', { desktop: { conversationAround, conversation, snapshot } });
  await useApp.getState().select('A', 'A-11');
  await useApp.getState().refresh();
  expect(useApp.getState().anchorMessageId).toBe('A-11');
  expect(useApp.getState().view?.messages.map((item) => item.sequence)).toEqual([10, 11, 12]);
  expect(conversation).not.toHaveBeenCalled();
  expect(snapshot).toHaveBeenCalledOnce();
  expect(useApp.getState().view?.conversation).toMatchObject({
    pinned: true,
    title: 'Renamed while searching',
  });
  expect(useApp.getState().error).toBe('');
  await useApp.getState().select('A');
  expect(useApp.getState().anchorMessageId).toBeNull();
  expect(useApp.getState().view?.messages.map((item) => item.sequence)).toEqual([110, 111, 112]);
});

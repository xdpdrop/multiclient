import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Comparisons } from '../../src/runtime/comparison';
import {
  comparisonRoutes,
  type ComparisonGroup,
  type ComparisonInput,
} from '../../src/shared/comparison';
import { attachmentSchema } from '../../src/shared/schema';
import { connections } from '../../src/shared/defaults';
import { Comparison } from '../../src/renderer/features/Comparison';
import type { Store } from '../../src/runtime/storage/store';
import type { Message, SendInput } from '../../src/shared/types';
import {
  ApiConnection,
  prepareApiRequest,
  type PreparedApiRequest,
} from '../../src/runtime/providers/api';
import type { AdapterContext } from '../../src/runtime/providers/contracts';

const state = vi.hoisted(() => ({
  groups: new Map<string, ComparisonGroup>(),
  requests: new Map<string, string>(),
  messages: new Map<string, Message[]>(),
}));
vi.mock('../../src/runtime/comparison/store', () => ({
  ComparisonStore: class {
    byRequest(requestId: string) {
      return state.requests.get(requestId);
    }
    create(input: ComparisonInput, history: Message[], revisions: string[]) {
      const id = crypto.randomUUID();
      const group: ComparisonGroup = {
        id,
        title: input.text,
        createdAt: new Date().toISOString(),
        sourceConversationId: input.sourceConversationId ?? null,
        state: 'prepared',
        contextCharacters: input.text.length,
        members: input.targets.map((target, index) => ({
          ...target,
          conversationId: `child-${index}`,
          configurationRevision: revisions[index],
          requestId: crypto.randomUUID(),
          status: 'prepared',
          text: '',
        })),
      };
      state.groups.set(id, group);
      state.requests.set(input.requestId, id);
      for (const member of group.members)
        state.messages.set(member.conversationId, structuredClone(history));
      return group;
    }
    read(id: string) {
      const group = state.groups.get(id);
      if (!group) throw new Error('Comparison not found.');
      return structuredClone(group);
    }
    list() {
      return [...state.groups.values()];
    }
    discard(id: string) {
      state.groups.delete(id);
    }
    markStarted(id: string) {
      state.groups.get(id)!.state = 'started';
    }
    failMember(id: string, conversationId: string, error: string) {
      const member = state.groups
        .get(id)!
        .members.find((m) => m.conversationId === conversationId)!;
      member.error = error;
      member.status = 'failed';
    }
  },
}));
beforeEach(() => {
  state.groups.clear();
  state.requests.clear();
  state.messages.clear();
  vi.unstubAllGlobals();
});
function setup() {
  const revision = { value: 'revision' };
  const configs = connections
    .filter((c) => c.kind === 'api-chat')
    .map((c) => ({ ...c, model: 'fixture-model' }));
  const saved = vi.fn();
  const store = {
    connection: (id: string) => configs.find((c) => c.id === id)!,
    configurationRevision: () => revision.value,
    conversation: (id: string) => ({ id, projectId: null, workspaceId: null }),
    messages: (id: string) => state.messages.get(id) ?? [],
    saveDraft: saved,
    branch: vi.fn((_id: string, _messageId: string) => ({ id: 'chosen-branch' })),
  };
  const sendPrepared = vi.fn(
    async (_input: SendInput, _prepared: PreparedApiRequest, _revision: string) => ({}),
  );
  const cancel = vi.fn(async (_conversationId: string) => {});
  const resolveContext = vi.fn(async () => ({
    contextText: 'Pinned knowledge revision 1',
    instructionsText: 'Pinned instructions revision 1',
  }));
  const service = new Comparisons({
    store: store as unknown as Store,
    coordinator: { activeTurns: () => [], cancel, sendPrepared, resolveContext },
    dataDir: '',
    secret: async () => 'fixture-key',
    changed: vi.fn(),
  });
  const input: ComparisonInput = {
    requestId: randomUUID(),
    text: 'Compare this answer',
    attachments: [],
    targets: [
      { providerId: 'openai', model: 'fixture-model' },
      { providerId: 'anthropic', model: 'fixture-model' },
    ],
    pdfDelivery: 'native',
  };
  return { service, input, sendPrepared, cancel, resolveContext, revision, store };
}
describe('API comparison', () => {
  it('executes the frozen endpoint, credentials and payload after preparation', async () => {
    const context: AdapterContext = {
      connection: {
        ...connections.find((connection) => connection.id === 'compatible')!,
        endpoint: 'http://localhost:11434/v1',
      },
      secret: 'original-key',
      dataDir: '',
      cwd: '',
      bridgePath: '',
      executable: '',
      signal: new AbortController().signal,
      emit: () => {},
      interact: async () => ({ id: '', allow: false }),
    };
    const request = { text: 'Original prompt', model: 'original-model', mode: 'chat', history: [] };
    const fetch = vi.fn(
      async () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Result' }, finish_reason: 'stop' }] })}\n\n`,
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const prepared = await prepareApiRequest(context, request);
    expect(fetch).not.toHaveBeenCalled();
    context.connection.endpoint = 'http://localhost:9999/changed';
    context.secret = 'replacement-key';
    request.text = 'Replacement prompt';
    request.model = 'replacement-model';
    await new ApiConnection(context).startPrepared(prepared);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(options.headers).toMatchObject({ authorization: 'Bearer original-key' });
    expect(JSON.parse(String(options.body))).toMatchObject({
      model: 'original-model',
      messages: [{ role: 'user', content: 'Original prompt' }],
    });
  });
  it('prepares every target without inference, freezes equivalent context and sends each exactly once', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { service, input, sendPrepared } = setup();
    const group = await service.prepare(input);
    expect(fetch).not.toHaveBeenCalled();
    expect(sendPrepared).not.toHaveBeenCalled();
    await Promise.all([service.start(group.id), service.start(group.id)]);
    await service.start(group.id);
    expect(sendPrepared).toHaveBeenCalledTimes(2);
    const bodies = sendPrepared.mock.calls.map(([, prepared]) => JSON.parse(prepared.body));
    expect(bodies[0].input[0].content).toBe(bodies[1].system);
    expect(bodies[0].input.at(-1).content).toBe(bodies[1].messages.at(-1).content);
    expect(bodies[0].input.at(-1).content).toContain('Pinned knowledge revision 1');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('deduplicates preparation requests and rejects unsupported inputs before any inference', async () => {
    const { service, input, sendPrepared } = setup();
    const [first, second] = await Promise.all([service.prepare(input), service.prepare(input)]);
    expect(first.id).toBe(second.id);
    await expect(
      service.prepare({
        ...input,
        requestId: randomUUID(),
        attachments: [
          {
            kind: 'image',
            path: 'image.png',
            content: '',
            assetId: randomUUID(),
            mime: 'image/png',
          },
        ],
      }),
    ).rejects.toThrow('Every compared model');
    expect(sendPrepared).not.toHaveBeenCalled();
  });
  it('rejects a changed connection or changed context for the whole prepared group', async () => {
    const { service, input, sendPrepared, revision, resolveContext } = setup();
    const group = await service.prepare(input);
    revision.value = 'changed';
    await expect(service.start(group.id)).rejects.toThrow('connection changed');
    expect(sendPrepared).not.toHaveBeenCalled();
    revision.value = 'revision';
    resolveContext.mockResolvedValue({
      contextText: 'Changed knowledge',
      instructionsText: 'Pinned instructions revision 1',
    });
    await expect(service.start(group.id)).rejects.toThrow('reviewed context changed');
    expect(sendPrepared).not.toHaveBeenCalled();
  });
  it('does not replay prepared groups after runtime restart', async () => {
    const { service, input, sendPrepared } = setup();
    const group = await service.prepare(input);
    (service as unknown as { prepared: Map<string, unknown> }).prepared.clear();
    await expect(service.start(group.id)).rejects.toThrow('preparation expired');
    expect(sendPrepared).not.toHaveBeenCalled();
  });
  it('retains another lane when one dispatch fails and scopes cancellation', async () => {
    const { service, input, sendPrepared, cancel } = setup();
    sendPrepared.mockRejectedValueOnce(new Error('Quota reached'));
    const group = await service.prepare(input);
    const started = await service.start(group.id);
    expect(sendPrepared).toHaveBeenCalledTimes(2);
    expect(started.members[0].error).toBe('Quota reached');
    await service.cancel(group.id, group.members[1].conversationId);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(group.members[1].conversationId);
    await expect(service.cancel(group.id, 'unrelated')).rejects.toThrow('does not belong');
  });
  it('uses stored selected history and blocks foreign or streaming selections', async () => {
    const { service, input } = setup();
    const message: Message = {
      id: randomUUID(),
      conversationId: 'source',
      sessionId: 'session',
      turnId: 'turn',
      role: 'assistant',
      text: 'Stored older answer',
      providerId: 'openai',
      status: 'completed',
      createdAt: new Date().toISOString(),
    };
    state.messages.set('source', [message]);
    await expect(
      service.prepare({
        ...input,
        sourceConversationId: 'source',
        historyMessageIds: [randomUUID()],
      }),
    ).rejects.toThrow('Selected history');
    state.messages.set('source', [{ ...message, status: 'streaming' }]);
    await expect(service.prepare({ ...input, sourceConversationId: 'source' })).rejects.toThrow(
      'running response',
    );
  });
  it('continues only from a completed member using an immutable ordinary branch', async () => {
    const { service, input, store } = setup();
    const group = await service.prepare(input);
    await expect(
      Promise.resolve().then(() => service.continue(group.id, group.members[0].conversationId)),
    ).rejects.toThrow('completed comparison');
    const stored = state.groups.get(group.id)!;
    stored.members[0].status = 'completed';
    stored.members[0].messageId = 'answer';
    expect(service.continue(group.id, group.members[0].conversationId)).toEqual({
      id: 'chosen-branch',
    });
    expect(store.branch).toHaveBeenCalledWith(group.members[0].conversationId, 'answer');
  });
  it('validates target counts and duplicate pairs through named route schemas', () => {
    const { input } = setup();
    const routes = comparisonRoutes(attachmentSchema);
    expect(routes.prepareComparison.safeParse(input).success).toBe(true);
    expect(
      routes.prepareComparison.safeParse({
        ...input,
        targets: [input.targets[0], input.targets[0]],
      }).success,
    ).toBe(false);
    expect(
      routes.prepareComparison.safeParse({ ...input, targets: [input.targets[0]] }).success,
    ).toBe(false);
    expect(
      routes.prepareComparison.safeParse({
        ...input,
        targets: [...input.targets, ...input.targets],
      }).success,
    ).toBe(false);
  });
  it('renders explicit extra usage, context review and accessible model controls', () => {
    vi.stubGlobal('window', { desktop: {} });
    const html = renderToStaticMarkup(
      createElement(Comparison, {
        connections: connections.filter((c) => c.kind === 'api-chat'),
        input: { text: 'Draft prompt', attachments: [] },
        onClose: () => {},
        onContinue: () => {},
      }),
    );
    expect(html).toContain('Each target incurs its own API usage');
    expect(html).toContain('aria-label="Comparison model 1"');
    expect(html).toContain('aria-label="Comparison provider 2"');
    expect(html).toContain('Context sent to every model');
    expect(html).toContain('Send to 2 models');
  });
});

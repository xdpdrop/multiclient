import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiConnection,
  listApiModels,
  testApiConnection,
  validateEndpoint,
} from '../../src/runtime/providers/api';
import { connections } from '../../src/shared/defaults';
import type { AdapterContext } from '../../src/runtime/providers/contracts';
import type { Message, ProviderEvent, ProviderId } from '../../src/shared/types';
import type { ContextSnapshot } from '../../src/shared/context';
import { validateSourceCitations } from '../../src/shared/research';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

afterEach(() => vi.unstubAllGlobals());
function setup(provider: ProviderId, frames: unknown[], status = 200) {
  const events: ProviderEvent[] = [];
  const abort = new AbortController();
  const context: AdapterContext = {
    cwd: '',
    dataDir: '',
    bridgePath: '',
    executable: '',
    connection: {
      ...connections.find((c) => c.id === provider)!,
      ...(provider === 'compatible' ? { endpoint: 'http://localhost:11434/v1' } : {}),
    },
    signal: abort.signal,
    emit: (event) => events.push(event),
    interact: async () => ({ id: '', allow: false }),
    secret: 'fixture-secret',
  };
  const fetch = vi.fn(
    async (_url: string, _options?: RequestInit) =>
      new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
        status,
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return { connection: new ApiConnection(context), fetch, events, abort, context };
}
const request = {
  text: 'Current prompt with attachment',
  model: 'fixture-model',
  mode: 'chat',
  history: [],
};
describe('API protocols', () => {
  it.each(['openai', 'anthropic', 'compatible'] as const)(
    'sends source-only history through %s and removes excluded or instruction-only context',
    async (provider) => {
      const included: ContextSnapshot = {
        id: randomUUID(),
        itemId: null,
        revision: 1,
        kind: 'web',
        title: 'Captured page',
        text: 'Fetched paragraph actually sent',
        projectId: null,
        createdAt: new Date().toISOString(),
        source: { url: 'https://example.com/captured' },
      };
      const excluded: ContextSnapshot = {
        ...included,
        id: randomUUID(),
        text: 'Excluded paragraph must not be sent',
      };
      const instructions: ContextSnapshot = {
        ...included,
        id: randomUUID(),
        kind: 'instructions',
        text: 'Unselected historical instructions must not be sent',
      };
      const incomplete: ContextSnapshot = {
        ...included,
        id: randomUUID(),
        text: 'Incomplete streaming context must not be sent',
      };
      const message = (
        role: Message['role'],
        text: string,
        contextSources?: ContextSnapshot[],
        status = 'sent',
      ): Message => ({
        id: randomUUID(),
        conversationId: randomUUID(),
        sessionId: randomUUID(),
        turnId: randomUUID(),
        role,
        text,
        contextSources,
        status,
        providerId: provider,
        createdAt: new Date().toISOString(),
      });
      const history = [
        message('user', '', [included]),
        message('assistant', 'Earlier answer', undefined, 'completed'),
        message('user', '', [excluded, instructions]),
        message('assistant', '', [incomplete], 'streaming'),
        message('user', request.text),
      ];
      const frames =
        provider === 'openai'
          ? [{ type: 'response.output_text.delta', delta: 'Reply' }, { type: 'response.completed' }]
          : provider === 'anthropic'
            ? [
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Reply' } },
                { type: 'message_stop' },
              ]
            : [{ choices: [{ delta: { content: 'Reply' }, finish_reason: 'stop' }] }];
      const { connection, fetch } = setup(provider, frames);
      await connection.startTurn({
        ...request,
        history,
        excludedContextSnapshotIds: [excluded.id],
      });
      const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
      const messages = provider === 'openai' ? body.input : body.messages;
      const marker = `[[source:${included.id}:1]]`;
      const hiddenMarker = `[[source:${excluded.id}:1]]`;
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toContain(included.text);
      expect(messages[0].content.split(marker)).toHaveLength(2);
      expect(JSON.stringify(messages)).not.toContain(excluded.text);
      expect(JSON.stringify(messages)).not.toContain(instructions.text);
      expect(JSON.stringify(messages)).not.toContain(incomplete.text);
      const audit = validateSourceCitations(
        `A supported claim ${marker}; an excluded claim ${hiddenMarker}`,
        [included],
      );
      expect(audit.sources).toEqual([included.id]);
      expect(audit.valid.map((citation) => citation.token)).toEqual([marker]);
      expect(audit.unresolved).toEqual([hiddenMarker]);
      await connection.startTurn({
        ...request,
        history,
        excludedContextSnapshotIds: [included.id, excluded.id],
      });
      const excludedBody = JSON.parse((fetch.mock.calls[1][1] as RequestInit).body as string);
      const remaining = provider === 'openai' ? excludedBody.input : excludedBody.messages;
      expect(remaining).toHaveLength(2);
      expect(JSON.stringify(remaining)).not.toContain('[[source:');
      expect(validateSourceCitations(marker, []).sources).toEqual([]);
    },
  );
  it('renders refusal deltas and rejects an empty completed response', async () => {
    const refusal = setup('openai', [
      { type: 'response.refusal.delta', delta: 'I cannot help with that.' },
      { type: 'response.completed' },
    ]);
    await refusal.connection.startTurn(request);
    expect(refusal.events).toContainEqual({ type: 'text', text: 'I cannot help with that.' });
    const empty = setup('openai', [{ type: 'response.completed' }]);
    await expect(empty.connection.startTurn(request)).rejects.toThrow('without returning text');
  });
  it('uses Responses, explicit credentials, abort signals and no server storage', async () => {
    const { connection, fetch, events, abort } = setup('openai', [
      { type: 'response.output_text.delta', delta: 'Hello' },
      { type: 'response.completed', response: { usage: { input_tokens: 2 } } },
    ]);
    await connection.startTurn(request);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options.signal).toBe(abort.signal);
    expect(options.redirect).toBe('error');
    expect(options.headers).toMatchObject({ authorization: 'Bearer fixture-secret' });
    expect(JSON.parse(options.body as string)).toMatchObject({
      store: false,
      model: 'fixture-model',
      input: [{ role: 'user', content: request.text }],
    });
    expect(events).toContainEqual({ type: 'text', text: 'Hello' });
  });
  it('uses Anthropic Messages headers and only text deltas', async () => {
    const { connection, fetch, events } = setup('anthropic', [
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Visible' } },
      { type: 'message_stop' },
    ]);
    await connection.startTurn(request);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.headers).toMatchObject({ 'x-api-key': 'fixture-secret' });
    expect(events).toEqual([{ type: 'text', text: 'Visible' }]);
  });
  it('retains partial output but rejects a truncated stream', async () => {
    const { connection, events } = setup('openai', [
      { type: 'response.output_text.delta', delta: 'Partial' },
    ]);
    await expect(connection.startTurn(request)).rejects.toThrow(/before the provider completed/);
    expect(events).toEqual([{ type: 'text', text: 'Partial' }]);
  });
  it('reports quota failures without retrying or changing billing source', async () => {
    const { connection, fetch } = setup('openai', [], 429);
    await expect(connection.startTurn(request)).rejects.toThrow(/usage limit/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('surfaces in-stream failure after HTTP success', async () => {
    const { connection } = setup('openai', [
      { type: 'response.failed', response: { error: { message: 'Failed request' } } },
    ]);
    await expect(connection.startTurn(request)).rejects.toThrow('Failed request');
  });
  it('preserves prior attachment context and system instructions', async () => {
    const { connection, fetch } = setup('anthropic', [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } },
      { type: 'message_stop' },
    ]);
    await connection.startTurn({
      ...request,
      history: [
        { role: 'system', text: 'Use clear language.', status: 'completed' },
        {
          role: 'user',
          text: 'What does this say?',
          context: 'Saved attachment: important facts',
          status: 'completed',
        },
        { role: 'assistant', text: 'It says facts.', status: 'completed' },
      ] as any,
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.system).toBe('Use clear language.');
    expect(body.messages[0].content).toContain('Saved attachment: important facts');
    expect(body.messages.at(-1).content).toBe(request.text);
  });
  it('rejects excessive accumulated context before a billable request', async () => {
    const { connection, fetch } = setup('openai', []);
    await expect(
      connection.startTurn({
        ...request,
        history: [{ role: 'assistant', text: 'a'.repeat(500001), status: 'completed' }] as any,
      }),
    ).rejects.toThrow('context is too large');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps compatible PDF fallback explicit and rejects images without verified model support', async () => {
    const { connection, fetch } = setup('compatible', []);
    fetch.mockResolvedValueOnce(
      new Response(
        'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    await connection.startTurn({
      ...request,
      attachments: [{ path: 'paper.pdf', kind: 'pdf', content: '[Page 1] Readable text' }],
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).toContain('PDF extracted text only');
    await expect(
      connection.startTurn({
        ...request,
        attachments: [{ path: 'image.png', kind: 'image', content: '' }],
      }),
    ).rejects.toThrow('not verified');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reports length termination as failure and captures nested Anthropic usage', async () => {
    const { connection, events } = setup('anthropic', [
      { type: 'message_start', message: { usage: { input_tokens: 17 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
      { type: 'message_stop' },
    ]);
    await expect(connection.startTurn(request)).rejects.toThrow('output limit');
    expect(events).toContainEqual({ type: 'usage', data: { input_tokens: 17 } });
    expect(events).toContainEqual({ type: 'text', text: 'Partial' });
  });
  it('discovers models from the configured base path and auth without inference', async () => {
    const config = {
      ...connections.find((c) => c.id === 'compatible')!,
      endpoint: 'http://localhost:1234/custom/v1',
    };
    const fetch = vi.fn(
      async (_url: string, _options?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: 'local-model' }, { id: 'local-model' }] })),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(listApiModels(config)).resolves.toEqual([
      { id: 'local-model', label: 'local-model', efforts: [], inputKinds: [] },
    ]);
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:1234/custom/v1/models');
    expect((fetch.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('authorization');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds model discovery responses and validates endpoint destinations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('a'.repeat(2 * 1024 * 1024 + 1))),
    );
    await expect(
      listApiModels(
        connections.find((c) => c.id === 'openai')!,
        'key',
      ),
    ).rejects.toThrow('limit');
    expect(() => validateEndpoint('http://example.com/v1')).toThrow('HTTPS');
    expect(() => validateEndpoint('https://user:password@example.com/v1')).toThrow('credentials');
  });
  it('only tests inference when explicitly invoked and requires a model', async () => {
    const { fetch } = setup('openai', [
      { type: 'response.output_text.delta', delta: 'OK' },
      { type: 'response.completed' },
    ]);
    const config = { ...connections.find((c) => c.id === 'openai')!, model: 'gpt-4.1' };
    expect(fetch).not.toHaveBeenCalled();
    await expect(testApiConnection(config, 'key')).resolves.toMatchObject({
      message: expect.stringContaining('completed'),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(testApiConnection({ ...config, model: '' }, 'key')).rejects.toThrow('model');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('serializes native cloud images from saved assets, never display paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'multiclient-api-asset-test-'));
    try {
      const id = randomUUID();
      await mkdir(join(directory, 'assets'));
      await writeFile(join(directory, 'assets', id), Buffer.from('image-bytes'));
      const { connection, context, fetch } = setup('openai', [
        { type: 'response.output_text.delta', delta: 'OK' },
        { type: 'response.completed' },
      ]);
      context.dataDir = directory;
      await connection.startTurn({
        ...request,
        model: 'gpt-4.1',
        attachments: [
          {
            path: 'C:/private/never-read.png',
            name: 'screenshot.png',
            kind: 'image',
            mime: 'image/png',
            content: '',
            assetId: id,
          },
        ],
      });
      const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.input[0].content[1]).toEqual({
        type: 'input_image',
        image_url: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects Anthropic images exceeding its encoded-byte limit before dispatch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'multiclient-api-limit-test-'));
    try {
      const id = randomUUID();
      await mkdir(join(directory, 'assets'));
      await writeFile(join(directory, 'assets', id), Buffer.alloc(8 * 1024 * 1024));
      const { connection, context, fetch } = setup('anthropic', []);
      context.dataDir = directory;
      await expect(
        connection.startTurn({
          ...request,
          model: 'claude-sonnet-4-6',
          attachments: [
            { path: 'large.png', kind: 'image', mime: 'image/png', content: '', assetId: id },
          ],
        }),
      ).rejects.toThrow('encoded image limit');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('keeps selected-page PDF extraction text-only even on a native-capable model', async () => {
    const { connection, fetch } = setup('openai', [
      { type: 'response.output_text.delta', delta: 'OK' },
      { type: 'response.completed' },
    ]);
    await connection.startTurn({
      ...request,
      model: 'gpt-4.1',
      attachments: [
        {
          path: 'full-document.pdf',
          kind: 'pdf',
          content: '[Page 2] Selected text',
          delivery: 'text',
        },
      ],
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.input[0].content).toContain('[Page 2] Selected text');
    expect(body.input[0].content).not.toContain('input_file');
  });
});

import { capabilities } from '../../../shared/defaults';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { formatContextSources } from '../../../shared/context';
import { supportsNativeAttachment } from '../../../shared/models';
import type { Attachment, Connection, Message, ModelOption } from '../../../shared/types';
import { sse } from '../../transports/sse';
import type { AdapterContext, ProviderConnection, StartTurnRequest } from '../contracts';
export function isLoopbackEndpoint(endpoint: string) {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}
export function validateEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  if (url.username || url.password || url.hash || url.search)
    throw new Error('Endpoint must not contain credentials, query parameters or fragments.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Use HTTPS, or HTTP for a local server.');
  return url.href.replace(/\/$/, '');
}
function headersFor(connection: Connection, secret?: string) {
  if (!secret && connection.id !== 'compatible')
    throw new Error('Add an API key in Connections. API billing is separate from subscriptions.');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (connection.id === 'anthropic') {
    headers['x-api-key'] = secret!;
    headers['anthropic-version'] = '2023-06-01';
  } else if (secret) headers.authorization = `Bearer ${secret}`;
  return headers;
}
async function checkResponse(response: Response) {
  if (response.ok) return;
  await response.body?.cancel();
  throw new Error(
    response.status === 401 || response.status === 403
      ? 'Authentication failed. Check your API key and account access.'
      : response.status === 429
        ? 'Rate or usage limit reached. Check your provider dashboard before retrying.'
        : response.status === 404
          ? 'The endpoint or model was not found. Check the API base URL and model ID.'
          : `API request failed (HTTP ${response.status}).`,
  );
}
export async function listApiModels(
  connection: Connection,
  secret?: string,
): Promise<ModelOption[]> {
  const endpoint = validateEndpoint(connection.endpoint);
  const response = await fetch(
    endpoint + '/models' + (connection.id === 'anthropic' ? '?limit=1000' : ''),
    {
      headers: headersFor(connection, secret),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    },
  );
  await checkResponse(response);
  if (!response.body) throw new Error('The provider returned no model list.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let value: { data?: unknown[] };
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > 2 * 1024 * 1024) throw new Error('The model list exceeded the response limit.');
      chunks.push(result.value);
    }
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!Array.isArray(value.data))
    throw new Error('The server did not return an API model list. Enter a custom model ID.');
  const ids = new Set<string>();
  return value.data.slice(0, 1000).flatMap((raw) => {
    const item = raw as { id?: unknown; display_name?: unknown; lifecycle?: string };
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      item.id.length > 200 ||
      ids.has(item.id) ||
      item.lifecycle === 'retired'
    )
      return [];
    if (
      connection.id === 'openai' &&
      /embedding|whisper|tts|dall-e|gpt-image|realtime|transcrib|moderation/.test(item.id)
    )
      return [];
    ids.add(item.id);
    const inputKinds = (['image', 'pdf'] as const).filter((kind) =>
      supportsNativeAttachment(connection.id, item.id as string, kind),
    );
    return [
      {
        id: item.id,
        label: typeof item.display_name === 'string' ? item.display_name.slice(0, 200) : item.id,
        efforts: [],
        inputKinds,
      },
    ];
  });
}
export async function testApiConnection(
  connection: Connection,
  secret?: string,
): Promise<{ message: string }> {
  if (!connection.model) throw new Error('Choose and save a model before testing the connection.');
  const client = new ApiConnection({
    connection,
    secret,
    cwd: '',
    dataDir: '',
    bridgePath: '',
    executable: '',
    signal: AbortSignal.timeout(30000),
    emit: () => {},
    interact: async () => {
      throw new Error('Connection tests cannot use tools.');
    },
  });
  await client.startTurn({
    text: 'Reply with OK.',
    model: connection.model,
    mode: 'chat',
    history: [],
  });
  return { message: 'The selected endpoint and model completed a test response.' };
}
export type PreparedApiRequest = Readonly<{
  provider: Connection['id'];
  model: string;
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}>;
// Preparing a request validates assets and capabilities without invoking inference.
export async function prepareApiRequest(
  context: Pick<AdapterContext, 'connection' | 'secret' | 'dataDir'>,
  request: StartTurnRequest & {
    contextText?: string;
    instructionsText?: string;
    excludedContextSnapshotIds?: string[];
  },
): Promise<PreparedApiRequest> {
  if (!request.model) throw new Error('Set a model ID in the composer or Connections.');
  const provider = context.connection.id;
  const endpoint = validateEndpoint(context.connection.endpoint);
  const headers = headersFor(context.connection, context.secret);
  const excludedSources = new Set(request.excludedContextSnapshotIds ?? []);
  const effectiveSources = (message: Message) =>
    (message.contextSources ?? []).filter(
      (source) => source.kind !== 'instructions' && !excludedSources.has(source.id),
    );
  const messages = request.history
    .filter(
      (m) =>
        m.status !== 'streaming' &&
        (m.text || m.context || m.attachments?.length || effectiveSources(m).length),
    )
    .map((m) => ({
      role: m.role,
      content: [m.context, formatContextSources(effectiveSources(m)), m.text]
        .filter(Boolean)
        .join('\n\n'),
      attachments: m.attachments,
    }));
  if (request.instructionsText)
    messages.unshift({ role: 'system', content: request.instructionsText, attachments: undefined });
  const currentText = [request.contextText, request.text].filter(Boolean).join('\n\n');
  // The persisted current user message is replaced by its explicit attachment/handoff payload.
  if (messages.at(-1)?.role === 'user') messages[messages.length - 1].content = currentText;
  else messages.push({ role: 'user', content: currentText, attachments: request.attachments });
  messages[messages.length - 1].attachments =
    request.attachments ?? messages[messages.length - 1].attachments;
  if (messages.reduce((size, message) => size + message.content.length, 0) > 500000)
    throw new Error(
      'Conversation context is too large. Start a new chat or fork from an earlier message.',
    );
  let binaryBytes = 0;
  let nativePdfPages = 0;
  let finalTextLength = 0;
  const apiMessages: { role: string; content: unknown }[] = [];
  for (const message of messages) {
    const parts: unknown[] = [];
    let text = message.content;
    for (const attachment of message.attachments ?? []) {
      if (!attachment.kind || attachment.kind === 'text') continue;
      const native =
        attachment.delivery !== 'text' &&
        supportsNativeAttachment(provider, request.model, attachment.kind);
      if (!native && attachment.kind === 'pdf') {
        if (!attachment.content.trim())
          throw new Error(
            'This PDF has no extracted text. Choose a cloud model supporting native PDFs, or attach a text version.',
          );
        text += `\n\nPDF extracted text only (${attachment.name ?? attachment.path}):\n${attachment.content}`;
        continue;
      }
      if (!native)
        throw new Error(
          'Native images are not verified for this model. Choose a supported OpenAI or Anthropic vision model.',
        );
      if (
        !attachment.assetId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attachment.assetId)
      )
        throw new Error('The saved attachment is unavailable. Attach the file again.');
      const path = join(context.dataDir, 'assets', attachment.assetId);
      const info = await stat(path);
      if (!info.isFile() || info.size > 10 * 1024 * 1024)
        throw new Error('The saved attachment exceeded the size limit.');
      if (
        provider === 'anthropic' &&
        attachment.kind === 'image' &&
        Math.ceil(info.size / 3) * 4 > 10 * 1024 * 1024
      )
        throw new Error(
          'This image exceeds Anthropic’s encoded image limit. Choose an image smaller than 7.5 MB.',
        );
      if (provider === 'anthropic' && attachment.kind === 'pdf') {
        nativePdfPages += attachment.pages?.length ?? 0;
        if (nativePdfPages > 100)
          throw new Error(
            'Send up to 100 native PDF pages at a time with this connection. Split the documents first.',
          );
      }
      binaryBytes += info.size;
      if (binaryBytes > 25 * 1024 * 1024)
        throw new Error(
          'This conversation contains too many image/PDF bytes. Start a new chat with fewer attachments.',
        );
      const bytes = await readFile(path);
      if (bytes.length !== info.size)
        throw new Error('The saved attachment changed while being read.');
      const data = bytes.toString('base64');
      if (attachment.kind === 'image') {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(attachment.mime ?? ''))
          throw new Error('Unsupported saved image format.');
        parts.push(
          provider === 'anthropic'
            ? { type: 'image', source: { type: 'base64', media_type: attachment.mime, data } }
            : { type: 'input_image', image_url: `data:${attachment.mime};base64,${data}` },
        );
      } else {
        parts.push(
          provider === 'anthropic'
            ? {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data },
                title: attachment.name ?? attachment.path,
              }
            : {
                type: 'input_file',
                filename: attachment.name ?? 'document.pdf',
                file_data: `data:application/pdf;base64,${data}`,
              },
        );
      }
    }
    finalTextLength += text.length;
    if (finalTextLength > 500000)
      throw new Error(
        'Conversation context is too large. Start a new chat with fewer attachments.',
      );
    apiMessages.push({
      role: message.role,
      content: parts.length
        ? [{ type: provider === 'openai' ? 'input_text' : 'text', text }, ...parts]
        : text,
    });
  }
  let path: string;
  let body: unknown;
  if (provider === 'anthropic') {
    path = '/messages';
    const system = apiMessages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    body = {
      model: request.model,
      max_tokens: 8192,
      messages: apiMessages.filter((m) => m.role !== 'system'),
      ...(system ? { system } : {}),
      stream: true,
    };
  } else {
    if (context.secret) headers.authorization = `Bearer ${context.secret}`;
    path = provider === 'openai' ? '/responses' : '/chat/completions';
    body =
      provider === 'openai'
        ? { model: request.model, input: apiMessages, stream: true, store: false }
        : { model: request.model, messages: apiMessages, stream: true };
  }
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > (provider === 'anthropic' ? 32 : 40) * 1024 * 1024)
    throw new Error('The combined request is too large. Remove attachments or start a new chat.');
  return Object.freeze({
    provider,
    model: request.model,
    url: endpoint + path,
    headers: Object.freeze(headers),
    body: serialized,
  });
}
export class ApiConnection implements ProviderConnection {
  capabilities;
  constructor(private context: AdapterContext) {
    this.capabilities = capabilities(context.connection.id);
  }
  async openSession() {
    return {};
  }
  async startTurn(request: StartTurnRequest) {
    await this.startPrepared(await prepareApiRequest(this.context, request));
  }
  async startPrepared(prepared: PreparedApiRequest) {
    const { provider, headers, body } = prepared;
    const response = await fetch(prepared.url, {
      method: 'POST',
      headers,
      body,
      signal: this.context.signal,
      redirect: 'error',
    });
    await checkResponse(response);
    if (!response.body) throw new Error('The provider returned no response stream.');
    let completed = false;
    let outputLength = 0;
    const emitText = (text: unknown) => {
      if (typeof text !== 'string') throw new Error('The provider returned an invalid text delta.');
      outputLength += text.length;
      if (outputLength > 4 * 1024 * 1024)
        throw new Error(
          'The response exceeded the output limit. Partial output has been preserved.',
        );
      this.context.emit({ type: 'text', text });
    };
    for await (const event of sse(response.body)) {
      if (event.data === '[DONE]') {
        if (provider === 'compatible') completed = true;
        continue;
      }
      const value = JSON.parse(event.data);
      if (value.error || value.type === 'error' || value.type === 'response.failed')
        throw new Error(
          value.error?.message ?? value.response?.error?.message ?? 'Provider stream failed.',
        );
      if (provider === 'openai') {
        if (value.type === 'response.output_text.delta' || value.type === 'response.refusal.delta')
          emitText(value.delta);
        if (value.type === 'response.incomplete')
          throw new Error(
            'The provider stopped before completing its response. Partial output has been preserved.',
          );
        if (value.type === 'response.completed') {
          completed = true;
          if (value.response?.usage)
            this.context.emit({ type: 'usage', data: value.response.usage });
        }
      } else if (provider === 'anthropic') {
        if (value.type === 'content_block_start' && value.content_block?.type === 'tool_use')
          throw new Error('This chat connection does not execute tools. Choose a text-chat model.');
        if (value.type === 'content_block_delta' && value.delta?.type === 'text_delta')
          emitText(value.delta.text);
        if (value.type === 'message_stop') completed = true;
        if (value.delta?.stop_reason === 'max_tokens')
          throw new Error(
            'The response reached its output limit. Partial output has been preserved.',
          );
        if (value.message?.usage) this.context.emit({ type: 'usage', data: value.message.usage });
        if (value.usage) this.context.emit({ type: 'usage', data: value.usage });
      } else {
        const choice = value.choices?.[0];
        if (choice?.delta?.content !== undefined && choice.delta.content !== null)
          emitText(choice.delta.content);
        if (choice?.finish_reason === 'length')
          throw new Error(
            'The response reached its output limit. Partial output has been preserved.',
          );
        if (choice?.finish_reason === 'tool_calls' || choice?.delta?.tool_calls)
          throw new Error('This chat connection does not execute tools. Choose a text-chat model.');
        if (choice?.finish_reason) completed = true;
        if (value.usage) this.context.emit({ type: 'usage', data: value.usage });
      }
    }
    if (!completed)
      throw new Error('The connection ended before the provider completed its response.');
    if (!outputLength)
      throw new Error(
        'The provider completed without returning text. Check that this model supports text chat.',
      );
  }
  async cancelTurn() {
    /* The coordinator aborts the fetch through its AbortSignal. */
  }
  async close() {}
}

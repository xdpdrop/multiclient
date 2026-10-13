import { Store } from '../storage/store';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { InteractionBroker } from '../permissions/broker';
import { connect } from '../providers';
import { findExecutable, version } from '../providers/process';
import { capabilities, assertProviderAvailable } from '../../shared/defaults';
import type { ProviderConnection } from '../providers/contracts';
import type { ProviderEvent, RuntimeEvent, SendInput, Turn, ProviderId } from '../../shared/types';
import { assertCertifiedMode } from '../../shared/certification';
import { classifyError } from '../../shared/errors';
import { checkoutOwnership } from '../files/ownership';
import { ContextStore } from '../context/storage';
import { formatContextSources, type ContextSnapshot } from '../../shared/context';
import { resolveArtifactContext, linkArtifactRevision } from '../artifacts/store';
import { ApiConnection, type PreparedApiRequest } from '../providers/api';
import type { Message } from '../../shared/types';
import { randomUUID } from 'node:crypto';
import { validateSourceCitations } from '../../shared/research';
export function redact(message: string) {
  return message.replace(/\b(?:sk-|sk-ant-|Bearer\s+)[\w.-]+/gi, '[redacted]').slice(0, 4000);
}
type Running = {
  turn: Turn;
  abort: AbortController;
  connection?: ProviderConnection;
  workspace: string | null;
  checkout: string | null;
  done: Promise<void>;
  contextSources: ContextSnapshot[];
  contextText: string;
  instructionsText: string;
  prepared?: PreparedApiRequest;
};
export class Coordinator {
  private running = new Map<string, Running>();
  readonly broker: InteractionBroker;
  constructor(
    private store: Store,
    private dataDir: string,
    private bridgePath: string,
    private emit: (event: RuntimeEvent) => void,
    private secret: (id: ProviderId) => Promise<string | undefined>,
  ) {
    this.broker = new InteractionBroker(
      (i) => {
        store.interaction(i);
        this.changed(i.conversationId);
      },
      (r) => store.resolveInteraction(r.id, r),
      (id) => store.cancelInteraction(id),
    );
  }
  activeTurns() {
    return [...this.running.values()].map((r) => r.turn);
  }
  busyProject(workspaceId: string) {
    return [...this.running.values()].some((r) => r.workspace === workspaceId);
  }
  private changed(id: string) {
    this.emit({ type: 'conversation', conversationId: id, cursor: this.store.cursor(id) });
    this.emit({ type: 'changed' });
  }
  resolveContext(
    input: Pick<
      SendInput,
      'conversationId' | 'contextRefs' | 'excludedContextSnapshotIds' | 'artifactReferences'
    >,
    history: Message[],
  ) {
    const conversation = this.store.conversation(input.conversationId);
    const excluded = new Set(input.excludedContextSnapshotIds ?? []);
    let inheritedInstructions: ContextSnapshot | undefined;
    for (const message of history)
      for (const source of message.contextSources ?? [])
        if (source.kind === 'instructions') inheritedInstructions = source;
    const refs =
      input.contextRefs ??
      (inheritedInstructions ? [inheritedInstructions] : []).map((source) => ({
        snapshotId: source.id,
        included: !excluded.has(source.id),
      }));
    const effectiveRefs = refs.map((ref) =>
      excluded.has(ref.snapshotId) ? { ...ref, included: false } : ref,
    );
    const contextSources = (
      effectiveRefs.length
        ? new ContextStore(this.store).resolve(
            effectiveRefs,
            conversation.projectId,
            conversation.id,
          )
        : []
    ).filter((source) => !excluded.has(source.id));
    const documents = contextSources.filter((source) => source.kind !== 'instructions');
    if (contextSources.filter((source) => source.kind === 'instructions').length > 1)
      throw new Error(
        'Choose one pinned project instruction revision. Use a new fork to apply updated instructions.',
      );
    const instructionsText = formatContextSources(
      contextSources.filter((source) => source.kind === 'instructions'),
    );
    const artifactText = input.artifactReferences?.length
      ? resolveArtifactContext(this.store.db, input.artifactReferences, input.conversationId)
      : '';
    const contextText = [formatContextSources(documents), artifactText]
      .filter(Boolean)
      .join('\n\n');
    return { contextText, instructionsText, contextSources, artifactText };
  }
  sendPrepared(input: SendInput, prepared: PreparedApiRequest, revision: string) {
    return this.send(input, { request: prepared, revision });
  }
  async send(
    input: SendInput,
    prepared?: { request: PreparedApiRequest; revision: string },
  ): Promise<Turn> {
    assertProviderAvailable(input.providerId);
    const duplicate = this.store.turnByRequest(input.requestId);
    if (duplicate) {
      if (duplicate.conversationId !== input.conversationId)
        throw new Error('Duplicate request belongs to another conversation.');
      return duplicate;
    }
    if (this.running.has(input.conversationId))
      throw new Error('This conversation already has an active turn.');
    const conversation = this.store.conversation(input.conversationId);
    if (conversation.archived) throw new Error('This conversation is archived.');
    const config = this.store.connection(input.providerId);
    if (!config.enabled) throw new Error('Enable this provider in Connections.');
    const cli = config.kind === 'cli-agent';
    if (
      prepared &&
      (cli ||
        prepared.request.provider !== config.id ||
        prepared.request.model !== (input.model || config.model) ||
        this.store.configurationRevision(config.id) !== prepared.revision)
    )
      throw new Error('The prepared connection changed. Prepare the comparison again.');
    if (cli && input.excludedContextSnapshotIds?.length && input.handoff === undefined)
      throw new Error(
        'A native session retains its previous context. Start a fresh chat with a reviewed context handoff to exclude saved sources.',
      );
    if (input.historyMessageIds !== undefined) {
      if (cli)
        throw new Error(
          'Native CLI history is managed by its saved session. Start a fresh conversation with an explicit context handoff to choose its history.',
        );
      const availableIds = new Set(
        this.store.messages(input.conversationId).map((message) => message.id),
      );
      if (input.historyMessageIds.some((id) => !availableIds.has(id)))
        throw new Error(
          'Selected history must belong to this conversation. Refresh the context selection before retrying.',
        );
    }
    if (cli && input.attachments.some((attachment) => attachment.kind === 'image'))
      throw new Error(
        'Native image attachments are not supported by this CLI connection yet. Use a supported API connection.',
      );
    if (
      cli &&
      input.attachments.some(
        (attachment) => attachment.kind === 'pdf' && !attachment.content.trim(),
      )
    )
      throw new Error(
        'This PDF has no extracted text. Native PDF input is not supported by this CLI connection. Use a supported API connection or attach extracted text.',
      );
    const workspace = conversation.workspaceId
      ? this.store.workspace(conversation.workspaceId)
      : undefined;
    if (workspace && workspace.projectId !== conversation.projectId)
      throw new Error('The conversation workspace does not belong to its project.');
    if (cli && workspace?.archived)
      throw new Error(
        'This workspace is archived. Choose an active workspace before starting an agent.',
      );
    if (cli && workspace && !workspace.trusted)
      throw new Error('Select a project and trust its directory before starting an agent.');
    if (cli && !workspace && input.mode !== 'ask')
      throw new Error('Select a trusted project to use this mode. Ask works without a project.');
    if (cli && conversation.workspaceId && this.busyProject(conversation.workspaceId))
      throw new Error('Another agent is running in this workspace.');
    if (!capabilities(input.providerId).modes.some((m) => m.id === input.mode))
      throw new Error('This mode is unavailable or has not passed permission verification.');
    const model = input.model || config.model;
    const configurationRevision = this.store.configurationRevision(input.providerId);
    if (input.effort && !['codex', 'claude-code'].includes(input.providerId))
      throw new Error('Reasoning depth is not supported by this connection.');
    const previous = this.store.lastSession(input.conversationId);
    const shared = this.resolveContext(input, this.store.messages(input.conversationId));
    if (
      cli &&
      previous &&
      !previous.nativeId &&
      this.store.messages(input.conversationId).length > 0 &&
      input.handoff === undefined
    )
      throw new Error(
        'Review the context handoff before starting a fresh native session with saved history.',
      );
    if (
      previous &&
      (previous.providerId !== input.providerId ||
        previous.model !== model ||
        previous.mode !== input.mode ||
        previous.configurationRevision !== configurationRevision) &&
      input.handoff === undefined
    )
      throw new Error(
        'Review the context handoff before starting a different provider, model or mode session.',
      );
    if (cli && previous?.nativeId && input.handoff === undefined) {
      const firstUser = this.store
        .transcript(previous.id)
        .find((message) => message.role === 'user');
      const originalInstructions = formatContextSources(
        (firstUser?.contextSources ?? []).filter((source) => source.kind === 'instructions'),
      );
      if (originalInstructions !== shared.instructionsText)
        throw new Error(
          'This native session retains its original project instructions. Start a new chat or review a fresh context handoff to change them.',
        );
    }
    const context = [
      input.handoff
        ? `Context explicitly shared by the user from another session:\n${input.handoff}`
        : '',
      ...input.attachments
        .filter((a) => cli || !a.kind || a.kind === 'text')
        .map(
          (a) => `User-attached text file: ${a.path}\n<attachment>\n${a.content}\n</attachment>`,
        ),
    ]
      .filter(Boolean)
      .join('\n\n');
    if (
      context.length +
        input.text.length +
        shared.contextText.length +
        shared.instructionsText.length >
      500000
    )
      throw new Error(
        'The combined context is too large. Remove attachments or shorten the handoff.',
      );
    let checkout: string | null = null;
    if (cli) {
      const executable = await findExecutable(config.id, config.executable, workspace?.path);
      assertCertifiedMode(
        input.providerId,
        input.mode,
        await version(executable),
        process.platform,
        process.env.MULTICLIENT_DEVELOPMENT_MODES === '1',
      );
      if (workspace) checkout = await checkoutOwnership(workspace.path);
      const accepted = this.store.turnByRequest(input.requestId);
      if (accepted) {
        if (accepted.conversationId !== input.conversationId)
          throw new Error('Duplicate request belongs to another conversation.');
        return accepted;
      }
      const current = this.store.conversation(input.conversationId);
      if (current.archived) throw new Error('This conversation is archived.');
      if (
        current.workspaceId !== conversation.workspaceId ||
        current.projectId !== conversation.projectId
      )
        throw new Error('The conversation workspace changed. Review its context before retrying.');
      if (this.running.has(input.conversationId))
        throw new Error('This conversation already has an active turn.');
      if (conversation.workspaceId && this.busyProject(conversation.workspaceId))
        throw new Error('Another agent is running in this workspace.');
      if (checkout && [...this.running.values()].some((run) => run.checkout === checkout))
        throw new Error(
          'Another agent is running in this checkout. Use a separate managed worktree for concurrent work.',
        );
      if (this.store.configurationRevision(input.providerId) !== configurationRevision)
        throw new Error(
          'The connection changed while checking compatibility. Review the connection and retry.',
        );
      if (workspace) {
        const currentWorkspace = this.store.workspace(workspace.id);
        if (currentWorkspace.archived)
          throw new Error('This workspace was archived while checking compatibility.');
        if (!currentWorkspace.trusted)
          throw new Error('Workspace trust changed. Review it before starting an agent.');
        if (
          currentWorkspace.path !== workspace.path ||
          currentWorkspace.projectId !== workspace.projectId
        )
          throw new Error('The workspace directory changed. Review its context before retrying.');
      }
    }
    const session = this.store.session(
      input.conversationId,
      input.providerId,
      model,
      input.mode,
      configurationRevision,
      cli && input.handoff !== undefined,
    );
    const startTurn = () => {
      const result = this.store.startTurn(
        input.conversationId,
        session,
        input.requestId,
        input.text,
        [context, shared.artifactText].filter(Boolean).join('\n\n'),
        input.effort ?? '',
        input.attachments,
        shared.contextSources,
      );
      for (const reference of input.artifactReferences ?? [])
        linkArtifactRevision(this.store.db, {
          ...reference,
          conversationId: input.conversationId,
          messageId: result.userId,
          relation: 'context',
        });
      return result;
    };
    const { turn, assistantId } = input.artifactReferences?.length
      ? this.store.db.transaction(startTurn)()
      : startTurn();
    const run: Running = {
      turn,
      abort: new AbortController(),
      workspace: cli ? conversation.workspaceId : null,
      checkout,
      done: Promise.resolve(),
      contextSources: shared.contextSources,
      contextText: shared.contextText,
      instructionsText: shared.instructionsText,
      prepared: prepared?.request,
    };
    this.running.set(input.conversationId, run);
    this.changed(input.conversationId);
    run.done = this.execute(
      run,
      input,
      session.nativeId,
      assistantId,
      workspace?.path ?? join(this.dataDir, 'chat-workspaces', conversation.id),
      { ...config, model },
    );
    return turn;
  }
  private async execute(
    run: Running,
    input: SendInput,
    nativeId: string | null,
    assistantId: string,
    cwd: string,
    config: ReturnType<Store['connection']>,
  ) {
    let buffer = '';
    let block: { itemId: string; phase: 'commentary' | 'answer' } | undefined;
    let timer: NodeJS.Timeout | undefined;
    let streamFailure: Error | undefined;
    let submittedSources: ContextSnapshot[] | undefined;
    let citationTail = '';
    let citationMentioned = false;
    const saveCitations = () => {
      if (!submittedSources) return;
      if (!citationMentioned && !submittedSources.some((source) => source.kind === 'web')) return;
      const message = this.store.db
        .prepare('SELECT text FROM messages WHERE id=?')
        .get(assistantId) as { text: string };
      if (
        !submittedSources.some((source) => source.kind === 'web') &&
        !message.text.includes('[[source:')
      )
        return;
      const audit = validateSourceCitations(message.text, submittedSources);
      this.store.db
        .prepare("DELETE FROM message_blocks WHERE message_id=? AND type='source-citations-v1'")
        .run(assistantId);
      this.store.db
        .prepare('INSERT INTO message_blocks VALUES (?,?,?,?,?)')
        .run(randomUUID(), assistantId, 3, 'source-citations-v1', JSON.stringify(audit));
    };
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (buffer) {
        const text = buffer;
        buffer = '';
        this.store.event(
          run.turn,
          'text',
          { text, ...block },
          { id: assistantId, delta: text, ...block },
        );
        this.changed(run.turn.conversationId);
      }
    };
    const fail = (e: unknown) => {
      streamFailure = e instanceof Error ? e : new Error(String(e));
      run.abort.abort();
    };
    const emit = (event: ProviderEvent) => {
      if (run.abort.signal.aborted) return;
      try {
        if (event.type === 'text') {
          const citationText = citationTail + event.text;
          citationMentioned ||= /\[\[source:/i.test(citationText);
          citationTail = citationText.slice(-9);
          if (block?.itemId !== event.itemId || block?.phase !== event.phase) flush();
          block = event.itemId
            ? { itemId: event.itemId, phase: event.phase ?? 'answer' }
            : undefined;
          buffer += event.text;
          if (buffer.length > 65536) flush();
          else
            timer ??= setTimeout(() => {
              try {
                flush();
              } catch (e) {
                fail(e);
              }
            }, 50);
        } else {
          flush();
          if (event.type === 'session')
            this.store.nativeSession(run.turn.sessionId, event.nativeId);
          this.store.event(run.turn, event.type, event.type === 'tool' ? event.tool : event);
          this.changed(run.turn.conversationId);
        }
      } catch (e) {
        fail(e);
      }
    };
    try {
      if (!run.workspace) await mkdir(cwd, { recursive: true });
      const executable =
        config.kind === 'cli-agent' ? await findExecutable(config.id, config.executable, cwd) : '';
      if (run.abort.signal.aborted) throw new Error('Cancelled');
      run.connection = await connect({
        cwd,
        dataDir: this.dataDir,
        bridgePath: this.bridgePath,
        executable,
        connection: config,
        mode: input.mode,
        signal: run.abort.signal,
        emit,
        secret:
          config.kind === 'api-chat' && !run.prepared ? await this.secret(config.id) : undefined,
        interact: async (request, signal) => {
          flush();
          run.turn.status = 'waiting';
          this.emit({
            type: 'turn-status',
            conversationId: run.turn.conversationId,
            status: 'waiting',
          });
          this.changed(run.turn.conversationId);
          try {
            return await this.broker.request(
              run.turn,
              request,
              signal ? AbortSignal.any([signal, run.abort.signal]) : run.abort.signal,
            );
          } finally {
            run.turn.status = 'running';
            this.changed(run.turn.conversationId);
          }
        },
      });
      if (run.abort.signal.aborted) throw new Error('Cancelled');
      await run.connection.openSession({ nativeId: nativeId ?? undefined });
      if (run.abort.signal.aborted) throw new Error('Cancelled');
      const text = [
        config.kind === 'cli-agent' ? run.contextText : '',
        config.kind === 'cli-agent' && !nativeId ? run.instructionsText : '',
        input.handoff
          ? `Context explicitly shared by the user from another session:\n${input.handoff}`
          : '',
        ...input.attachments
          .filter((a) => config.kind === 'cli-agent' || !a.kind || a.kind === 'text')
          .map(
            (a) => `User-attached text file: ${a.path}\n<attachment>\n${a.content}\n</attachment>`,
          ),
        input.text,
      ]
        .filter(Boolean)
        .join('\n\n');
      if (text.length > 500000)
        throw new Error(
          'The combined context is too large. Remove attachments or shorten the handoff.',
        );
      run.turn.status = 'running';
      this.changed(run.turn.conversationId);
      let history = this.store.transcript(run.turn.sessionId);
      if (input.historyMessageIds !== undefined) {
        const selected = new Set(input.historyMessageIds);
        history = this.store
          .messages(input.conversationId)
          .filter(
            (message) =>
              selected.has(message.id) ||
              (message.turnId === run.turn.id && message.role === 'user'),
          );
        this.store.event(run.turn, 'context-selection', { messageIds: input.historyMessageIds });
      }
      const request = {
        text,
        model: config.model,
        mode: input.mode,
        effort: input.effort,
        history,
        attachments: input.attachments,
        contextText: run.contextText,
        instructionsText: run.instructionsText,
        excludedContextSnapshotIds: input.excludedContextSnapshotIds,
      };
      const excludedSources = new Set(input.excludedContextSnapshotIds ?? []);
      submittedSources = [
        ...new Map(
          [...history.flatMap((message) => message.contextSources ?? []), ...run.contextSources]
            .filter((source) => !excludedSources.has(source.id))
            .map((source) => [source.id, source]),
        ).values(),
      ];
      if (run.prepared) {
        if (!(run.connection instanceof ApiConnection))
          throw new Error('Prepared requests require an API connection.');
        await run.connection.startPrepared(run.prepared);
      } else await run.connection.startTurn(request);
      flush();
      saveCitations();
      if (streamFailure) throw streamFailure;
      const status = run.abort.signal.aborted ? 'cancelled' : 'completed';
      this.store.finish(run.turn, status);
      this.emit({ type: 'turn-status', conversationId: run.turn.conversationId, status });
    } catch (e) {
      try {
        flush();
        saveCitations();
        const errorInfo = streamFailure
          ? classifyError(
              new Error('Conversation storage failed. Check disk space before retrying.'),
            )
          : run.abort.signal.aborted
            ? undefined
            : classifyError(e);
        this.store.finish(
          run.turn,
          streamFailure ? 'failed' : run.abort.signal.aborted ? 'cancelled' : 'failed',
          errorInfo?.message,
          errorInfo,
        );
        this.emit({
          type: 'turn-status',
          conversationId: run.turn.conversationId,
          status: streamFailure ? 'failed' : run.abort.signal.aborted ? 'cancelled' : 'failed',
        });
      } catch {
        this.emit({
          type: 'runtime-error',
          message: 'Conversation storage failed. Check disk space and restart the app.',
        });
      }
    } finally {
      clearTimeout(timer);
      this.broker.cancel(run.turn.id);
      try {
        await run.connection?.close();
      } catch {
        /* The turn result is already durable; shutdown is best effort. */
      }
      this.running.delete(run.turn.conversationId);
      try {
        this.changed(run.turn.conversationId);
      } catch {
        this.emit({
          type: 'runtime-error',
          message: 'Conversation storage is unavailable. Check disk space and restart.',
        });
      }
    }
  }
  async cancel(conversationId: string) {
    const run = this.running.get(conversationId);
    if (!run) return;
    run.abort.abort();
    this.broker.cancel(run.turn.id);
    try {
      await run.connection?.cancelTurn();
    } catch {
      await run.connection?.close();
    }
    await Promise.race([run.done, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
    if (this.running.has(conversationId)) await run.connection?.close();
  }
  async close() {
    await Promise.all([...this.running.keys()].map((id) => this.cancel(id)));
    await Promise.all([...this.running.values()].map((r) => r.done));
  }
}

import { randomUUID } from 'node:crypto';
import { prepareApiRequest, type PreparedApiRequest } from '../providers/api';
import type { Store } from '../storage/store';
import type { Coordinator } from '../conversations/coordinator';
import type { ComparisonInput, ComparisonGroup } from '../../shared/comparison';
import type { Connection, Message, ProviderId, SendInput } from '../../shared/types';
import type { ContextSnapshot } from '../../shared/context';
import { supportsNativeAttachment } from '../../shared/models';
import { ComparisonStore } from './store';

type Dependencies = {
  store: Store;
  coordinator: Pick<Coordinator, 'activeTurns' | 'cancel'> & {
    sendPrepared(
      input: SendInput,
      prepared: PreparedApiRequest,
      revision: string,
    ): Promise<unknown>;
    resolveContext(
      input: {
        conversationId: string;
        contextRefs?: ComparisonInput['contextRefs'];
        excludedContextSnapshotIds?: string[];
        artifactReferences?: ComparisonInput['artifactReferences'];
      },
      history: Message[],
    ):
      | Promise<{
          contextText?: string;
          instructionsText?: string;
          contextSources?: ContextSnapshot[];
        }>
      | { contextText?: string; instructionsText?: string; contextSources?: ContextSnapshot[] };
  };
  dataDir: string;
  secret: (providerId: ProviderId) => Promise<string | undefined>;
  changed: () => void;
};
type PreparedGroup = {
  expires: number;
  prepared: PreparedApiRequest[];
  inputs: SendInput[];
  revisions: string[];
  configs: Connection[];
  contextText?: string;
  instructionsText?: string;
};
export class Comparisons {
  readonly repository: ComparisonStore;
  private prepared = new Map<string, PreparedGroup>();
  private preparing = new Map<string, Promise<ComparisonGroup>>();
  private starting = new Map<string, Promise<ComparisonGroup>>();
  constructor(private dependencies: Dependencies) {
    this.repository = new ComparisonStore(dependencies.store);
  }
  prepare(input: ComparisonInput) {
    const underway = this.preparing.get(input.requestId);
    if (underway) return underway;
    const operation = this.prepareOnce(structuredClone(input));
    this.preparing.set(input.requestId, operation);
    void operation.finally(() => this.preparing.delete(input.requestId)).catch(() => {});
    return operation;
  }
  private async prepareOnce(input: ComparisonInput): Promise<ComparisonGroup> {
    const { store, coordinator, secret, dataDir, changed } = this.dependencies;
    const existing = this.repository.byRequest(input.requestId);
    if (existing) {
      const group = this.repository.read(existing);
      if (group.state === 'started' || this.prepared.has(existing)) return group;
      throw new Error('This preparation expired. Prepare a new comparison before sending.');
    }
    if (
      input.targets.length < 2 ||
      input.targets.length > 3 ||
      new Set(input.targets.map((t) => `${t.providerId}:${t.model}`)).size !== input.targets.length
    )
      throw new Error('Choose 2–3 distinct provider/model targets.');
    const source = input.sourceConversationId
      ? store.conversation(input.sourceConversationId)
      : undefined;
    if (
      source &&
      ((input.projectId && input.projectId !== source.projectId) ||
        (input.workspaceId && input.workspaceId !== source.workspaceId))
    )
      throw new Error('Comparison context must stay in its source project.');
    const available = source ? store.messages(source.id) : [];
    if (!source && input.historyMessageIds?.length)
      throw new Error('Choose a source conversation before selecting history.');
    const selected = input.historyMessageIds ? new Set(input.historyMessageIds) : undefined;
    if (selected && [...selected].some((id) => !available.some((m) => m.id === id)))
      throw new Error('Selected history is no longer available. Review the comparison.');
    const history = available.filter((m) => !selected || selected.has(m.id));
    if (history.some((m) => m.status === 'streaming'))
      throw new Error('Exclude the running response or wait until it completes.');
    const allAttachments = [...history.flatMap((m) => m.attachments ?? []), ...input.attachments];
    for (const attachment of allAttachments) {
      if (
        attachment.kind === 'image' &&
        input.targets.some((t) => !supportsNativeAttachment(t.providerId, t.model, 'image'))
      )
        throw new Error('Every compared model must support the selected images.');
      if (attachment.kind === 'pdf') {
        if (input.pdfDelivery === 'text' && !attachment.content.trim())
          throw new Error('This PDF has no extracted text. Choose native-PDF models or remove it.');
        if (
          input.pdfDelivery === 'native' &&
          (attachment.delivery === 'text' ||
            input.targets.some((t) => !supportsNativeAttachment(t.providerId, t.model, 'pdf')))
        )
          throw new Error(
            'Choose models supporting native PDFs, or explicitly compare using extracted PDF text.',
          );
        attachment.delivery = input.pdfDelivery;
      }
    }
    const configs = input.targets.map((target) => {
      const config = store.connection(target.providerId);
      if (config.kind !== 'api-chat' || !config.enabled || !target.model.trim())
        throw new Error('Choose enabled API Chat connections and models.');
      return { ...config, model: target.model };
    });
    const revisions = configs.map((c) => store.configurationRevision(c.id));
    const secrets = await Promise.all(configs.map((c) => secret(c.id)));
    this.assertRevisions(configs, revisions);
    const group = this.repository.create(input, history, revisions);
    try {
      const firstHistory = store.messages(group.members[0].conversationId);
      // One resolution pins identical knowledge/instructions for all models.
      const context = await coordinator.resolveContext(
        {
          conversationId: group.members[0].conversationId,
          contextRefs: input.contextRefs,
          excludedContextSnapshotIds: input.excludedContextSnapshotIds,
          artifactReferences: input.artifactReferences,
        },
        firstHistory,
      );
      const refs =
        context.contextSources?.map((source) => ({
          snapshotId: source.id,
          included: true,
          ...(input.contextRefs?.find((ref) => ref.snapshotId === source.id)?.reviewed
            ? { reviewed: true }
            : {}),
        })) ?? input.contextRefs;
      const inputs: SendInput[] = group.members.map((member) => ({
        conversationId: member.conversationId,
        requestId: member.requestId,
        providerId: member.providerId,
        model: member.model,
        mode: 'chat',
        text: input.text,
        attachments: input.attachments,
        handoff: '',
        ...(refs ? { contextRefs: refs } : {}),
        ...(input.excludedContextSnapshotIds
          ? { excludedContextSnapshotIds: input.excludedContextSnapshotIds }
          : {}),
        ...(input.artifactReferences ? { artifactReferences: input.artifactReferences } : {}),
      }));
      const prepared = await Promise.all(
        configs.map((connection, index) => {
          const messages = store.messages(group.members[index].conversationId);
          const current: Message = {
            id: randomUUID(),
            conversationId: group.members[index].conversationId,
            sessionId: '',
            turnId: '',
            role: 'user',
            text: input.text,
            status: 'sent',
            providerId: connection.id,
            createdAt: new Date().toISOString(),
            attachments: input.attachments,
          };
          const text = [
            ...input.attachments
              .filter((a) => !a.kind || a.kind === 'text')
              .map(
                (a) =>
                  `User-attached text file: ${a.path}\n<attachment>\n${a.content}\n</attachment>`,
              ),
            input.text,
          ].join('\n\n');
          return prepareApiRequest(
            { connection, secret: secrets[index], dataDir },
            {
              model: connection.model,
              mode: 'chat',
              text,
              history: [...messages, current],
              attachments: input.attachments,
              ...context,
              excludedContextSnapshotIds: input.excludedContextSnapshotIds,
            },
          );
        }),
      );
      this.assertRevisions(configs, revisions);
      this.prepared.set(group.id, {
        expires: Date.now() + 5 * 60 * 1000,
        prepared,
        inputs,
        revisions,
        configs,
        contextText: context.contextText,
        instructionsText: context.instructionsText,
      });
      setTimeout(() => this.prepared.delete(group.id), 5 * 60 * 1000).unref();
      changed();
      return this.repository.read(group.id);
    } catch (error) {
      this.repository.discard(group.id);
      throw error;
    }
  }
  private assertRevisions(configs: Connection[], revisions: string[]) {
    for (const [index, config] of configs.entries())
      if (
        !this.dependencies.store.connection(config.id).enabled ||
        this.dependencies.store.configurationRevision(config.id) !== revisions[index]
      )
        throw new Error('A connection changed. Review the targets and prepare again.');
  }
  start(id: string) {
    const current = this.starting.get(id);
    if (current) return current;
    const operation = this.startOnce(id);
    this.starting.set(id, operation);
    void operation.finally(() => this.starting.delete(id)).catch(() => {});
    return operation;
  }
  private async startOnce(id: string) {
    const group = this.repository.read(id);
    if (group.state === 'started') return group;
    const ready = this.prepared.get(id);
    if (!ready || ready.expires < Date.now()) {
      this.prepared.delete(id);
      throw new Error('Comparison preparation expired. Prepare again before sending.');
    }
    this.assertRevisions(ready.configs, ready.revisions);
    const context = await this.dependencies.coordinator.resolveContext(
      ready.inputs[0],
      this.dependencies.store.messages(ready.inputs[0].conversationId),
    );
    if (
      context.contextText !== ready.contextText ||
      context.instructionsText !== ready.instructionsText
    )
      throw new Error('The reviewed context changed. Prepare a new comparison before sending.');
    this.assertRevisions(ready.configs, ready.revisions);
    if (
      ready.inputs.some((input) =>
        this.dependencies.coordinator
          .activeTurns()
          .some((turn) => turn.conversationId === input.conversationId),
      )
    )
      throw new Error('A comparison chat is already running.');
    this.repository.markStarted(id);
    this.prepared.delete(id);
    const results = await Promise.allSettled(
      ready.inputs.map((input, index) =>
        this.dependencies.coordinator.sendPrepared(
          input,
          ready.prepared[index],
          ready.revisions[index],
        ),
      ),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected')
        this.repository.failMember(
          id,
          ready.inputs[index].conversationId,
          String(result.reason instanceof Error ? result.reason.message : result.reason),
        );
      else this.dependencies.store.saveDraft(ready.inputs[index].conversationId, null);
    }
    this.dependencies.changed();
    return this.repository.read(id);
  }
  async cancel(id: string, conversationId?: string) {
    const group = this.repository.read(id);
    if (conversationId && !group.members.some((member) => member.conversationId === conversationId))
      throw new Error('This chat does not belong to the comparison.');
    await Promise.all(
      group.members
        .filter((m) => !conversationId || m.conversationId === conversationId)
        .map((m) => this.dependencies.coordinator.cancel(m.conversationId)),
    );
    this.dependencies.changed();
  }
  continue(id: string, conversationId: string) {
    const member = this.repository
      .read(id)
      .members.find((m) => m.conversationId === conversationId);
    if (!member || member.status !== 'completed' || !member.messageId)
      throw new Error('Choose a completed comparison answer.');
    const conversation = this.dependencies.store.branch(conversationId, member.messageId);
    this.dependencies.changed();
    return conversation;
  }
  read(id: string) {
    const group = this.repository.read(id);
    const active = this.dependencies.coordinator.activeTurns();
    return {
      ...group,
      members: group.members.map((member) => ({
        ...member,
        status:
          active.find((turn) => turn.conversationId === member.conversationId)?.status ??
          member.status,
      })),
    };
  }
  list() {
    return this.repository.list().map((group) => this.read(group.id));
  }
}
export function comparisonHandlers(dependencies: Dependencies) {
  const service = new Comparisons(dependencies);
  return {
    prepareComparison: (input: ComparisonInput) => service.prepare(input),
    startComparison: (input: { id: string }) => service.start(input.id),
    comparisons: () => service.list(),
    comparison: (input: { id: string }) => service.read(input.id),
    cancelComparison: (input: { id: string; conversationId?: string }) =>
      service.cancel(input.id, input.conversationId),
    continueComparison: (input: { id: string; conversationId: string }) =>
      service.continue(input.id, input.conversationId),
  };
}

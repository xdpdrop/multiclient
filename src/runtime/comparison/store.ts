import { randomUUID } from 'node:crypto';
import type { Store } from '../storage/store';
import type { ComparisonGroup, ComparisonInput, ComparisonTarget } from '../../shared/comparison';
import type { Message } from '../../shared/types';
import { copyArtifactReferences } from '../artifacts/store';

type GroupRow = Omit<ComparisonGroup, 'members'> & { requestId: string };
type MemberRow = ComparisonTarget & {
  conversationId: string;
  requestId: string;
  configurationRevision: string;
  error: string | null;
};
export class ComparisonStore {
  constructor(readonly store: Store) {}
  byRequest(requestId: string): string | undefined {
    return (
      this.store.db
        .prepare('SELECT id FROM comparison_groups WHERE request_id=?')
        .get(requestId) as { id: string } | undefined
    )?.id;
  }
  list() {
    return (
      this.store.db
        .prepare('SELECT id FROM comparison_groups ORDER BY created_at DESC LIMIT 100')
        .all() as { id: string }[]
    ).map((row) => this.read(row.id));
  }
  read(id: string): ComparisonGroup {
    const row = this.store.db
      .prepare(
        'SELECT id,request_id AS requestId,title,source_conversation_id AS sourceConversationId,created_at AS createdAt,state,context_characters AS contextCharacters FROM comparison_groups WHERE id=?',
      )
      .get(id) as GroupRow | undefined;
    if (!row) throw new Error('Comparison not found.');
    const members = this.rows(id).map((member) => {
      const turn = this.store.turnByRequest(member.requestId);
      const view = this.store.view(member.conversationId);
      const message = turn
        ? view.messages.find((m) => m.turnId === turn.id && m.role === 'assistant')
        : undefined;
      return {
        ...member,
        status:
          turn?.status ??
          (member.error
            ? ('failed' as const)
            : row.state === 'started'
              ? ('interrupted' as const)
              : ('prepared' as const)),
        text: message?.text ?? '',
        messageId: message?.id,
        error: turn?.error ?? member.error ?? undefined,
        errorInfo: message?.errorInfo ?? turn?.errorInfo,
        usage: turn ? view.usage : undefined,
      };
    });
    const { requestId: _requestId, ...group } = row;
    return { ...group, members };
  }
  rows(id: string) {
    return this.store.db
      .prepare(
        'SELECT conversation_id AS conversationId,provider_id AS providerId,model,request_id AS requestId,configuration_revision AS configurationRevision,error FROM comparison_members WHERE group_id=? ORDER BY position',
      )
      .all(id) as MemberRow[];
  }
  create(input: ComparisonInput, history: Message[], revisions: string[]) {
    return this.store.db.transaction(() => {
      const id = randomUUID();
      const source = input.sourceConversationId
        ? this.store.conversation(input.sourceConversationId)
        : undefined;
      const projectId = input.projectId ?? source?.projectId ?? undefined;
      const workspaceId = input.workspaceId ?? source?.workspaceId ?? undefined;
      const title = input.title ?? input.text.slice(0, 100);
      this.store.db.prepare('INSERT INTO comparison_groups VALUES (?,?,?,?,?,?,?)').run(
        id,
        input.requestId,
        title,
        source?.id ?? null,
        new Date().toISOString(),
        'prepared',
        history.reduce(
          (sum, m) => sum + m.text.length + (m.context?.length ?? 0),
          input.text.length,
        ),
      );
      for (const [position, target] of input.targets.entries()) {
        const c = this.store.createConversation(projectId, workspaceId);
        this.store.db
          .prepare('UPDATE conversations SET title=?,provider_id=?,model=?,mode=? WHERE id=?')
          .run(
            `${title.slice(0, 100)} · ${target.model}`,
            target.providerId,
            target.model,
            'chat',
            c.id,
          );
        const session = this.store.session(
          c.id,
          target.providerId,
          target.model,
          'chat',
          revisions[position],
        );
        for (const message of history) {
          const turnId = randomUUID();
          const messageId = randomUUID();
          this.store.db
            .prepare(
              'INSERT INTO turns(id,conversation_id,session_id,request_id,status,created_at,ended_at) VALUES (?,?,?,?,?,?,?)',
            )
            .run(
              turnId,
              c.id,
              session.id,
              randomUUID(),
              'completed',
              message.createdAt,
              message.createdAt,
            );
          this.store.db
            .prepare(
              'INSERT INTO messages(id,conversation_id,session_id,turn_id,role,text,status,provider_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
            )
            .run(
              messageId,
              c.id,
              session.id,
              turnId,
              message.role,
              message.text,
              message.status,
              message.providerId,
              message.createdAt,
            );
          const blocks = this.store.db
            .prepare(
              'SELECT position,type,content FROM message_blocks WHERE message_id=? ORDER BY position',
            )
            .all(message.id) as { position: number; type: string; content: string }[];
          for (const block of blocks)
            this.store.db
              .prepare('INSERT INTO message_blocks VALUES (?,?,?,?,?)')
              .run(
                randomUUID(),
                messageId,
                block.position,
                block.type,
                block.type === 'attachments-v1'
                  ? JSON.stringify(message.attachments ?? [])
                  : block.content,
              );
          this.store.db
            .prepare(
              'INSERT INTO message_assets(message_id,asset_id) SELECT ?,asset_id FROM message_assets WHERE message_id=?',
            )
            .run(messageId, message.id);
          copyArtifactReferences(this.store.db, message.id, messageId);
        }
        this.store.saveDraft(c.id, {
          text: input.text,
          attachments: input.attachments,
          provider: target.providerId,
          model: target.model,
          mode: 'chat',
          effort: '',
          ...(input.contextRefs ? { contextRefs: input.contextRefs } : {}),
          ...(input.excludedContextSnapshotIds
            ? { excludedContextSnapshotIds: input.excludedContextSnapshotIds }
            : {}),
          ...(input.artifactReferences ? { artifactReferences: input.artifactReferences } : {}),
        });
        this.store.db
          .prepare('INSERT INTO comparison_members VALUES (?,?,?,?,?,?,?,NULL)')
          .run(
            id,
            position,
            c.id,
            target.providerId,
            target.model,
            randomUUID(),
            revisions[position],
          );
      }
      return this.read(id);
    })();
  }
  discard(id: string) {
    this.store.db.transaction(() => {
      for (const member of this.rows(id)) {
        this.store.saveDraft(member.conversationId, null);
        this.store.db.prepare('DELETE FROM conversations WHERE id=?').run(member.conversationId);
      }
      this.store.db.prepare('DELETE FROM comparison_groups WHERE id=?').run(id);
    })();
  }
  markStarted(id: string) {
    this.store.db
      .prepare("UPDATE comparison_groups SET state='started' WHERE id=? AND state='prepared'")
      .run(id);
  }
  failMember(id: string, conversationId: string, error: string) {
    this.store.db
      .prepare('UPDATE comparison_members SET error=? WHERE group_id=? AND conversation_id=?')
      .run(error.slice(0, 4000), id, conversationId);
  }
}

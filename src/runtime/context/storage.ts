import { createHash, randomUUID } from 'node:crypto';
import type { Store } from '../storage/store';
import { attachmentSchema } from '../../shared/schema';
import {
  CONTEXT_MAX_CHARACTERS,
  CONTEXT_MAX_SOURCES,
  PROJECT_DOCUMENT_MAX_CHARACTERS,
  contextSnapshotSchema,
  contextSourceSchema,
  type ContextItem,
  type ContextKind,
  type ContextRef,
  type ContextSnapshot,
  type ContextSnapshotSummary,
  type SaveContextItem,
} from '../../shared/context';

type ItemRow = {
  id: string;
  projectId: string | null;
  kind: ContextKind;
  title: string;
  text: string;
  revision: number;
  includeInNewChats: number;
  updatedAt: string;
  source: string | null;
  attachment: string | null;
};
const selectItems =
  'SELECT id,project_id AS projectId,kind,title,text,revision,include_new_chats AS includeInNewChats,updated_at AS updatedAt,source,attachment FROM context_items';
function decode(row: ItemRow): ContextItem {
  return {
    ...row,
    includeInNewChats: !!row.includeInNewChats,
    source: row.source ? contextSourceSchema.parse(JSON.parse(row.source)) : undefined,
    attachment: row.attachment ? attachmentSchema.parse(JSON.parse(row.attachment)) : undefined,
  };
}
function validateContent(kind: ContextKind, text: string) {
  const limit = kind === 'instructions' ? 20000 : kind === 'memory' ? 10000 : 100000;
  if (!text.trim()) throw new Error('Write some text before saving this source.');
  if (text.length > limit)
    throw new Error(
      `This ${kind} source supports up to ${limit.toLocaleString('en-US')} characters.`,
    );
}

export class ContextStore {
  constructor(private store: Store) {}
  items(projectId: string | null, kind?: ContextKind): ContextItem[] {
    if (projectId) this.store.project(projectId);
    return (
      this.store.db
        .prepare(
          selectItems +
            ' WHERE project_id IS ? AND (? IS NULL OR kind=?) ORDER BY updated_at DESC,id',
        )
        .all(projectId, kind ?? null, kind ?? null) as ItemRow[]
    ).map(decode);
  }
  item(id: string): ContextItem {
    const row = this.store.db.prepare(selectItems + ' WHERE id=?').get(id) as ItemRow | undefined;
    if (!row) throw new Error('This source is no longer in the library.');
    return decode(row);
  }
  save(input: SaveContextItem): ContextItem {
    return this.store.db.transaction(() => {
      if (input.projectId) this.store.project(input.projectId);
      if (!input.projectId && ['instructions', 'note', 'document'].includes(input.kind))
        throw new Error('Choose a project for this source.');
      validateContent(input.kind, input.text);
      if (input.kind === 'web' || input.source?.web)
        throw new Error(
          'Capture web sources through Web research. Library edits cannot impersonate fetched pages.',
        );
      const title = input.title.trim();
      if (!title || title.length > 200)
        throw new Error('Source titles must contain 1–200 characters.');
      const previous = input.id ? this.item(input.id) : undefined;
      if (previous && (previous.projectId !== input.projectId || previous.kind !== input.kind))
        throw new Error('A source cannot be moved to another scope or kind.');
      if (previous && previous.revision !== input.expectedRevision)
        throw new Error('This source changed. Reload it before saving your edits.');
      if (!previous) {
        const count = this.items(
          input.projectId,
          input.kind === 'memory' ? 'memory' : undefined,
        ).filter((item) => input.kind === 'memory' || item.kind !== 'memory').length;
        if (count >= (input.kind === 'memory' ? 100 : 50))
          throw new Error(
            'This library has reached its source limit. Remove a source before adding another.',
          );
        if (input.kind === 'instructions' && this.items(input.projectId, 'instructions').length)
          throw new Error('Edit the existing project instructions instead of adding another copy.');
      }
      const attachment = input.attachment
        ? attachmentSchema.parse(input.attachment)
        : previous?.attachment;
      if (attachment?.kind === 'image')
        throw new Error('Project knowledge supports notes, text and extracted PDF text.');
      if (attachment?.assetId && !this.store.asset(attachment.assetId))
        throw new Error('Import this source before adding it to the library.');
      const source = input.source
        ? contextSourceSchema.parse(input.source)
        : input.attachment
          ? {
              ...(attachment?.assetId ? { assetId: attachment.assetId } : {}),
              ...(attachment?.pages ? { pages: attachment.pages.map((page) => page.page) } : {}),
            }
          : previous?.source;
      if (source?.assetId && !this.store.asset(source.assetId))
        throw new Error('The source asset is unavailable.');
      const id = previous?.id ?? randomUUID();
      this.store.db
        .prepare(
          'INSERT INTO context_items(id,project_id,kind,title,text,revision,include_new_chats,updated_at,source,attachment) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,text=excluded.text,revision=excluded.revision,include_new_chats=excluded.include_new_chats,updated_at=excluded.updated_at,source=excluded.source,attachment=excluded.attachment',
        )
        .run(
          id,
          input.projectId,
          input.kind,
          title,
          input.text,
          (previous?.revision ?? 0) + 1,
          +(
            input.includeInNewChats ??
            previous?.includeInNewChats ??
            input.kind === 'instructions'
          ),
          new Date().toISOString(),
          source ? JSON.stringify(source) : null,
          attachment ? JSON.stringify(attachment) : null,
        );
      if (input.projectId) {
        const defaults = this.items(input.projectId).filter(
          (item) => item.includeInNewChats && ['note', 'document'].includes(item.kind),
        );
        if (
          defaults.length > 10 ||
          defaults.reduce((total, item) => total + item.text.length, 0) >
            PROJECT_DOCUMENT_MAX_CHARACTERS
        )
          throw new Error(
            'New-chat document defaults support up to 10 sources and 200,000 characters.',
          );
      }
      return this.item(id);
    })();
  }
  remove(id: string, expectedRevision: number) {
    const result = this.store.db
      .prepare('DELETE FROM context_items WHERE id=? AND revision=?')
      .run(id, expectedRevision);
    if (!result.changes) throw new Error('This source changed or was removed. Reload the library.');
  }
  createSnapshot(input: Omit<ContextSnapshot, 'id' | 'createdAt'>): ContextSnapshot {
    const snapshot = contextSnapshotSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    validateContent(snapshot.kind, snapshot.text);
    if (
      snapshot.source?.web &&
      createHash('sha256').update(snapshot.text).digest('hex') !== snapshot.source.web.hash
    )
      throw new Error('The web source text does not match its captured hash.');
    if (snapshot.source?.assetId && !this.store.asset(snapshot.source.assetId))
      throw new Error('The source asset is unavailable.');
    this.store.db
      .prepare('INSERT INTO context_snapshots VALUES (?,?)')
      .run(snapshot.id, JSON.stringify(snapshot));
    return snapshot;
  }
  snapshot(id: string): ContextSnapshot {
    const row = this.store.db
      .prepare('SELECT content FROM context_snapshots WHERE id=?')
      .get(id) as { content: string } | undefined;
    if (!row) throw new Error('The saved source snapshot is unavailable.');
    const snapshot = contextSnapshotSchema.parse(JSON.parse(row.content));
    if (
      snapshot.source?.web &&
      createHash('sha256').update(snapshot.text).digest('hex') !== snapshot.source.web.hash
    )
      throw new Error('The saved web source does not match its captured hash.');
    return snapshot;
  }
  conversationSources(conversationId: string): ContextSnapshotSummary[] {
    this.store.conversation(conversationId);
    const rows = this.store.db
      .prepare(
        "SELECT json_extract(source.value,'$.id') AS id,json_extract(source.value,'$.itemId') AS itemId,json_extract(source.value,'$.revision') AS revision,json_extract(source.value,'$.kind') AS kind,json_extract(source.value,'$.title') AS title,json_extract(source.value,'$.projectId') AS projectId,json_extract(source.value,'$.createdAt') AS createdAt,length(json_extract(source.value,'$.text')) AS characters,json_remove(json_extract(source.value,'$.source'),'$.web') AS source,json_group_array(DISTINCT m.id) AS messageIds,json_group_array(DISTINCT m.session_id) AS sessionIds FROM message_blocks b JOIN messages m ON m.id=b.message_id,json_each(b.content) source WHERE m.conversation_id=? AND b.type='context-sources-v1' GROUP BY json_extract(source.value,'$.id') ORDER BY createdAt,id",
      )
      .all(conversationId) as (Omit<
      ContextSnapshotSummary,
      'source' | 'messageIds' | 'sessionIds'
    > & { source: string | null; messageIds: string; sessionIds: string })[];
    return rows.map(({ source, messageIds, sessionIds, ...row }) => ({
      ...row,
      messageIds: JSON.parse(messageIds),
      sessionIds: JSON.parse(sessionIds),
      source: source ? contextSourceSchema.parse(JSON.parse(source)) : undefined,
    }));
  }
  snapshotItems(ids: string[]): ContextRef[] {
    if (ids.length > CONTEXT_MAX_SOURCES || new Set(ids).size !== ids.length)
      throw new Error('Choose distinct sources within the source limit.');
    return this.store.db.transaction(() =>
      ids.map((id) => {
        const item = this.item(id);
        const existing = this.store.db
          .prepare(
            "SELECT id FROM context_snapshots WHERE json_extract(content,'$.itemId')=? AND json_extract(content,'$.revision')=? LIMIT 1",
          )
          .get(item.id, item.revision) as { id: string } | undefined;
        const snapshotId =
          existing?.id ??
          this.createSnapshot({
            itemId: item.id,
            revision: item.revision,
            kind: item.kind,
            title: item.title,
            text: item.text,
            projectId: item.projectId,
            source: item.source,
          }).id;
        return { snapshotId, included: true };
      }),
    )();
  }
  resolve(
    refs: ContextRef[],
    projectId?: string | null,
    conversationId?: string,
  ): ContextSnapshot[] {
    if (refs.length > CONTEXT_MAX_SOURCES)
      throw new Error('Too many shared sources. Remove a source before sending.');
    if (new Set(refs.map((ref) => ref.snapshotId)).size !== refs.length)
      throw new Error('Choose each source only once.');
    const included = [
      ...new Set(refs.filter((ref) => ref.included).map((ref) => ref.snapshotId)),
    ].map((id) => this.snapshot(id));
    const historical = new Set<string>(
      conversationId
        ? (
            this.store.db
              .prepare(
                "SELECT json_extract(source.value,'$.id') AS id FROM message_blocks b JOIN messages m ON m.id=b.message_id,json_each(b.content) source WHERE m.conversation_id=? AND b.type='context-sources-v1'",
              )
              .all(conversationId) as { id: string }[]
          ).map((row) => row.id)
        : [],
    );
    for (const snapshot of included) {
      if (
        projectId !== undefined &&
        snapshot.projectId &&
        snapshot.projectId !== projectId &&
        !historical.has(snapshot.id)
      )
        throw new Error(
          'A selected source belongs to another project. Review your sources before sending.',
        );
      if (
        snapshot.itemId &&
        !historical.has(snapshot.id) &&
        !refs.some((ref) => ref.snapshotId === snapshot.id && ref.reviewed)
      ) {
        const current = this.store.db
          .prepare('SELECT revision FROM context_items WHERE id=?')
          .get(snapshot.itemId) as { revision: number } | undefined;
        if (!current || current.revision !== snapshot.revision)
          throw new Error(
            'A library source changed or was removed. Review the captured version in Sources before sending.',
          );
      }
    }
    const documents = included.filter(
      (snapshot) => snapshot.kind === 'document' || snapshot.kind === 'note',
    );
    const web = included.filter((snapshot) => snapshot.kind === 'web');
    if (web.length > 8 || web.reduce((total, snapshot) => total + snapshot.text.length, 0) > 80000)
      throw new Error(
        'Web context supports up to 8 sources and 80,000 characters. Deselect some sources.',
      );
    if (
      documents.length > 10 ||
      documents.reduce((total, snapshot) => total + snapshot.text.length, 0) >
        PROJECT_DOCUMENT_MAX_CHARACTERS
    )
      throw new Error(
        'Project documents support up to 10 sources and 200,000 characters. Deselect some sources.',
      );
    if (
      included.reduce((total, snapshot) => total + snapshot.text.length, 0) > CONTEXT_MAX_CHARACTERS
    )
      throw new Error('Shared sources exceed the 300,000 character limit. Deselect some sources.');
    return included;
  }
  projectDefaults(projectId: string): ContextRef[] {
    const items = this.items(projectId).filter(
      (item) => item.includeInNewChats && ['instructions', 'note', 'document'].includes(item.kind),
    );
    const refs = this.snapshotItems(items.map((item) => item.id));
    this.resolve(refs, projectId);
    return refs;
  }
}

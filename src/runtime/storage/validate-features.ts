import type { Store } from './store';
import { ContextStore } from '../context/storage';
import { contextRoutes, contextSnapshotSchema } from '../../shared/context';
import { sourceCitationAuditSchema, validateSourceCitations } from '../../shared/research';
import { ArtifactsStore } from '../artifacts/store';
import { artifactSource, exportedArtifactSchema } from '../../shared/artifacts';
import { promptTemplateInputSchema, tagNameSchema } from '../../shared/organization';
import { createHash } from 'node:crypto';
import { draftSchema } from '../../shared/schema';

export function validateFeatureData(store: Store) {
  const context = new ContextStore(store);
  const checkAsset = (id?: string) => {
    if (id && !store.asset(id)) throw new Error('The backup references a missing source asset.');
  };
  for (const row of store.db.prepare('SELECT id FROM context_items').all() as { id: string }[]) {
    const item = context.item(row.id);
    contextRoutes.saveContextItem.parse({
      id: item.id,
      expectedRevision: item.revision,
      projectId: item.projectId,
      kind: item.kind,
      title: item.title,
      text: item.text,
      includeInNewChats: item.includeInNewChats,
      source: item.source,
      attachment: item.attachment,
    });
    if (
      (!item.projectId && ['instructions', 'note', 'document'].includes(item.kind)) ||
      !item.text.trim() ||
      item.text.length >
        (item.kind === 'instructions' ? 20000 : item.kind === 'memory' ? 10000 : 100000)
    )
      throw new Error('The backup contains invalid library content.');
    checkAsset(item.source?.assetId);
    checkAsset(item.attachment?.assetId);
  }
  for (const row of store.db.prepare('SELECT id FROM context_snapshots').all() as {
    id: string;
  }[]) {
    const snapshot = context.snapshot(row.id);
    checkAsset(snapshot.source?.assetId);
    if (
      snapshot.source?.web &&
      createHash('sha256').update(snapshot.text).digest('hex') !== snapshot.source.web.hash
    )
      throw new Error('The backup contains a damaged web source.');
  }
  for (const block of store.db
    .prepare(
      "SELECT b.type,b.content,m.text FROM message_blocks b JOIN messages m ON m.id=b.message_id WHERE b.type IN ('context-sources-v1','source-citations-v1')",
    )
    .iterate() as Iterable<{ type: string; content: string; text: string }>) {
    const data = JSON.parse(block.content);
    if (block.type === 'context-sources-v1') {
      if (!Array.isArray(data) || data.length > 30)
        throw new Error('The backup contains invalid source records.');
      for (const value of data) {
        const snapshot = contextSnapshotSchema.parse(value);
        if (JSON.stringify(snapshot) !== JSON.stringify(context.snapshot(snapshot.id)))
          throw new Error('The backup contains inconsistent source snapshots.');
      }
    } else {
      const audit = sourceCitationAuditSchema.parse(data);
      const actual = validateSourceCitations(
        block.text,
        audit.sources.map((id) => context.snapshot(id)),
      );
      if (
        JSON.stringify(actual.valid) !== JSON.stringify(audit.valid) ||
        JSON.stringify(actual.unresolved) !== JSON.stringify(audit.unresolved) ||
        JSON.stringify(actual.sources) !== JSON.stringify(audit.sources) ||
        (actual.truncated && !audit.truncated) ||
        (actual.omittedOccurrences ?? 0) > (audit.omittedOccurrences ?? 0)
      )
        throw new Error('The backup contains inconsistent source citations.');
    }
  }
  const artifacts = new ArtifactsStore(store.db);
  for (const row of store.db.prepare('SELECT content FROM drafts').iterate() as Iterable<{
    content: string;
  }>) {
    const draft = draftSchema.parse(JSON.parse(row.content));
    for (const ref of draft.contextRefs ?? []) context.snapshot(ref.snapshotId);
    for (const attachment of draft.attachments) checkAsset(attachment.assetId);
    for (const ref of draft.artifactReferences ?? [])
      artifacts.revision(ref.artifactId, ref.revisionId);
  }
  for (const artifact of artifacts.list()) {
    const view = artifacts.view(artifact.id);
    for (let offset = 0; offset < view.revisions.length; offset += 1000)
      exportedArtifactSchema.parse({
        id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        language: artifact.language,
        headRevisionId: artifact.headRevisionId,
        revisions: view.revisions.slice(offset, offset + 1000).map((revision) => ({
          id: revision.id,
          number: revision.number,
          parentRevisionId: revision.parentRevisionId,
          source: revision.source,
          author: revision.author,
          createdAt: revision.createdAt,
          assetIds: revision.assetIds,
        })),
        references: [],
      });
    artifacts.revision(artifact.id, artifact.headRevisionId);
    const revisions = new Map(view.revisions.map((revision) => [revision.id, revision]));
    for (const revision of view.revisions) {
      if (
        revision.parentRevisionId &&
        (!revisions.has(revision.parentRevisionId) ||
          revisions.get(revision.parentRevisionId)!.number >= revision.number)
      )
        throw new Error('The backup contains an invalid artifact parent.');
      revision.assetIds.forEach(checkAsset);
    }
    if (view.draft) {
      artifactSource.parse(view.draft.source);
      if (
        !revisions.has(view.draft.baseRevisionId) ||
        !Number.isSafeInteger(view.draft.generation) ||
        view.draft.generation < 1
      )
        throw new Error('The backup contains an invalid artifact draft.');
    }
  }
  for (const row of store.db.prepare('SELECT name FROM tags').all() as { name: string }[])
    tagNameSchema.parse(row.name);
  for (const row of store.db
    .prepare('SELECT id,revision,name,body,project_id AS projectId FROM prompt_templates')
    .all())
    promptTemplateInputSchema.parse(row);
  const badComparison = store.db
    .prepare(
      'SELECT id FROM comparison_groups g WHERE (SELECT COUNT(*) FROM comparison_members WHERE group_id=g.id) NOT BETWEEN 2 AND 3 LIMIT 1',
    )
    .get();
  if (badComparison) throw new Error('The backup contains an incomplete comparison group.');
}

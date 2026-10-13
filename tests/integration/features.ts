import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { Store } from '../../src/runtime/storage/store';
import { ContextStore } from '../../src/runtime/context/storage';
import { createMemoryHandlers } from '../../src/runtime/memory';
import { ArtifactsStore, linkArtifactRevision } from '../../src/runtime/artifacts/store';
import { ComparisonStore } from '../../src/runtime/comparison/store';
import { OrganizationService } from '../../src/runtime/organization';
import { validateRestoredDatabase } from '../../src/runtime/storage/backup';
import {
  embeddedAssets,
  installRestore,
  prepareRestore,
  writeBackup,
} from '../../src/main/history';
import type { RuntimeHost } from '../../src/main/runtime';
import type { Attachment } from '../../src/shared/types';

const expand = promisify(gunzip);
const compress = promisify(gzip);

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-features-test-'));
  const migrations = resolve('migrations');
  const database = join(directory, 'multiclient.sqlite');
  let store: Store | undefined;
  const active = () => {
    assert.ok(store);
    return store;
  };
  const host = {
    async request(route: string, input: any = {}) {
      if (route === 'backupData') return active().backup(input.path);
      if (route === 'validateBackup') return validateRestoredDatabase(input.path, migrations);
      if (route === 'snapshot') return { projects: active().projects() };
      throw new Error(`Unsupported feature fixture route ${route}`);
    },
    async stop() {
      store?.close();
      store = undefined;
    },
    async start() {
      store = new Store(database, migrations);
    },
  } as unknown as RuntimeHost;

  try {
    // Upgrade a populated old profile rather than testing only a fresh schema.
    const old = new Database(database);
    const folder = { id: randomUUID(), workspaceId: randomUUID() };
    const original = {
      id: randomUUID(),
      sessionId: randomUUID(),
      turnId: randomUUID(),
      messageId: randomUUID(),
    };
    const oldDate = new Date().toISOString();
    try {
      for (const file of (await readdir(migrations))
        .filter((file) => /^00[1-4]_.*\.sql$/.test(file))
        .sort()) {
        old.exec(await readFile(join(migrations, file), 'utf8'));
        old
          .prepare('INSERT INTO schema_migrations VALUES (?,?)')
          .run(Number(file.split('_')[0]), oldDate);
      }
      old.prepare('INSERT INTO projects VALUES (?,?,?)').run(folder.id, 'Existing folder', oldDate);
      old
        .prepare('INSERT INTO workspaces(id,project_id,path) VALUES (?,?,?)')
        .run(folder.workspaceId, folder.id, join(directory, 'existing-project'));
      old
        .prepare(
          'INSERT INTO conversations(id,project_id,workspace_id,title,provider_id,model,mode,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          original.id,
          folder.id,
          folder.workspaceId,
          'Old conversation',
          'openai',
          'fixture-model',
          'chat',
          oldDate,
        );
      old
        .prepare(
          'INSERT INTO provider_sessions(id,conversation_id,provider_id,model,mode,capabilities,created_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(original.sessionId, original.id, 'openai', 'fixture-model', 'chat', '{}', oldDate);
      old
        .prepare(
          'INSERT INTO turns(id,conversation_id,session_id,request_id,status,created_at,ended_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(
          original.turnId,
          original.id,
          original.sessionId,
          randomUUID(),
          'completed',
          oldDate,
          oldDate,
        );
      old
        .prepare(
          'INSERT INTO messages(id,conversation_id,session_id,turn_id,role,text,status,provider_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          original.messageId,
          original.id,
          original.sessionId,
          original.turnId,
          'user',
          'Old profile message',
          'sent',
          'openai',
          oldDate,
        );
    } finally {
      old.close();
    }
    const failedMigrations = join(directory, 'failed-migrations');
    await mkdir(failedMigrations);
    await writeFile(
      join(failedMigrations, '005_failure.sql'),
      "ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'folder';\nINSERT INTO nonexistent_table VALUES (1);",
    );
    assert.throws(() => new Store(database, failedMigrations), /nonexistent_table/);
    const rolledBack = new Database(database);
    try {
      assert.equal(
        (
          rolledBack.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
            version: number;
          }
        ).version,
        4,
      );
      assert.equal(
        (rolledBack.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).some(
          (column) => column.name === 'kind',
        ),
        false,
      );
      assert.equal(
        (
          rolledBack.prepare('SELECT text FROM messages WHERE id=?').get(original.messageId) as {
            text: string;
          }
        ).text,
        'Old profile message',
      );
    } finally {
      rolledBack.close();
    }
    store = new Store(database, migrations);
    assert.deepEqual(
      active()
        .messages(original.id)
        .map((m) => [m.id, m.text, m.status]),
      [[original.messageId, 'Old profile message', 'sent']],
    );
    assert.equal(active().project(folder.id).kind, 'folder');
    assert.equal(active().project(folder.id).workspaceId, folder.workspaceId);

    const project = active().createChatProject('Writing and research');
    assert.equal(project.kind, 'chat');
    assert.equal(project.path, null);
    assert.equal(project.workspaceId, null);
    assert.ok(
      active()
        .projects()
        .some((p) => p.id === project.id),
    );
    assert.ok(
      !active()
        .workspaces()
        .some((w) => w.projectId === project.id),
    );
    assert.throws(
      () => active().addWorkspace(project.id, directory, 'main', 'HEAD'),
      /folder project/,
    );

    await mkdir(join(directory, 'assets'));
    await mkdir(join(directory, 'credentials'));
    const credential = `private-key-${randomUUID()}`;
    await writeFile(join(directory, 'credentials', 'openai'), credential);
    const imageId = randomUUID();
    const imageBytes = Buffer.from('app-owned image fixture');
    const pdfId = randomUUID();
    const pdfBytes = Buffer.from('app-owned PDF fixture');
    for (const [id, bytes, mime, type] of [
      [imageId, imageBytes, 'image/png', 'image'],
      [pdfId, pdfBytes, 'application/pdf', 'pdf'],
    ] as const) {
      await writeFile(join(directory, 'assets', id), bytes);
      active().registerAsset({
        id,
        mime,
        type,
        size: bytes.length,
        hash: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    const image: Attachment = {
      path: 'deleted-original.png',
      name: 'deleted-original.png',
      kind: 'image',
      assetId: imageId,
      mime: 'image/png',
      size: imageBytes.length,
      content: '',
    };
    const context = new ContextStore(active());
    const instructions = context.save({
      projectId: project.id,
      kind: 'instructions',
      title: 'Editorial rules',
      text: 'Use short sentences and cite sources.',
    });
    const document = context.save({
      projectId: project.id,
      kind: 'document',
      title: 'Captured document',
      text: 'Page 2: lighthouse requirement.',
      includeInNewChats: true,
      source: { assetId: pdfId, pages: [2] },
    });
    const refs = context.projectDefaults(project.id);
    const captured = context.resolve(refs, project.id);
    assert.equal(captured.length, 2);
    const memory = createMemoryHandlers(active(), context);
    const globalMemory = memory.memorySave({
      projectId: null,
      title: 'Preferred style',
      text: 'Prefer practical examples.',
    });
    const projectMemory = memory.memorySave({
      projectId: project.id,
      title: 'Audience',
      text: 'This document is for lighthouse engineers.',
      includeNewChats: true,
    });
    assert.deepEqual(
      memory.memoryDefaults({ projectId: project.id }).map((m) => m.itemId),
      [projectMemory.id],
    );
    assert.deepEqual(memory.memoryDefaults({ projectId: null }), []);
    const memorySnapshot = memory.memoryInclude({
      id: globalMemory.id,
      expectedRevision: 1,
      projectId: project.id,
    });
    assert.throws(
      () =>
        memory.memoryInclude({ id: projectMemory.id, expectedRevision: 1, projectId: folder.id }),
      /another project/,
    );
    const web = context.createSnapshot({
      itemId: null,
      revision: 1,
      kind: 'web',
      title: 'Captured public page',
      text: 'The lighthouse is open on Sunday.',
      projectId: project.id,
      source: {
        url: 'https://example.com/lighthouse',
        retrievedAt: new Date().toISOString(),
        web: {
          requestedUrl: 'https://example.com/lighthouse',
          mime: 'text/html',
          hash: createHash('sha256').update('The lighthouse is open on Sunday.').digest('hex'),
          truncated: false,
          paragraphs: [{ id: 1, text: 'The lighthouse is open on Sunday.' }],
        },
      },
    });
    const sources = [...captured, memorySnapshot, web];
    const chat = active().createConversation(project.id);
    const chatSession = active().session(chat.id, 'openai', 'fixture-model', 'chat');
    const turn = active().startTurn(
      chat.id,
      chatSession,
      randomUUID(),
      'Draft a lighthouse report',
      '',
      '',
      [image],
      sources,
    );
    active().event(
      turn.turn,
      'text',
      {},
      { id: turn.assistantId, delta: '# Lighthouse report\n\nA short report.' },
    );
    active().finish(turn.turn, 'completed');
    const sent = active().messages(chat.id)[0];
    assert.deepEqual(sent.contextSources, sources);

    // Future library edits/deletion cannot mutate the captured turn.
    const updatedInstructions = context.save({
      ...instructions,
      expectedRevision: instructions.revision,
      text: 'New editorial instructions.',
    });
    context.remove(document.id, document.revision);
    memory.memoryDelete({ id: globalMemory.id, expectedRevision: globalMemory.revision });
    assert.deepEqual(active().messages(chat.id)[0].contextSources, sources);
    assert.equal(
      context.snapshot(
        refs.find((r) => context.snapshot(r.snapshotId).itemId === instructions.id)!.snapshotId,
      ).text,
      instructions.text,
    );
    assert.equal(
      context
        .projectDefaults(project.id)
        .map((r) => context.snapshot(r.snapshotId))
        .find((s) => s.kind === 'instructions')?.text,
      updatedInstructions.text,
    );
    assert.throws(() => context.resolve(refs, project.id), /changed or was removed/);
    assert.deepEqual(context.resolve(refs, project.id, chat.id), captured);

    const artifacts = new ArtifactsStore(active().db);
    const artifact = artifacts.create({
      title: 'Lighthouse report',
      kind: 'markdown',
      source: `# Draft one\n\n![Sketch](media://assets/${imageId})`,
      originConversationId: chat.id,
      originMessageId: turn.assistantId,
      assetIds: [imageId],
    });
    const firstRevision = artifact.revisions[0];
    linkArtifactRevision(active().db, {
      conversationId: chat.id,
      messageId: sent.id,
      artifactId: artifact.artifact.id,
      revisionId: firstRevision.id,
      relation: 'context',
    });
    const draftResult = artifacts.saveDraft({
      id: artifact.artifact.id,
      baseRevisionId: firstRevision.id,
      source: '# Unfinished edit',
      expectedGeneration: 0,
    });
    assert.equal(draftResult.ok, true);
    assert.equal(
      artifacts.saveDraft({
        id: artifact.artifact.id,
        baseRevisionId: firstRevision.id,
        source: '# Stale edit',
        expectedGeneration: 0,
      }).ok,
      false,
    );
    const revisionResult = artifacts.commit({
      id: artifact.artifact.id,
      expectedHeadRevisionId: firstRevision.id,
      source: '# Accepted revision two',
      assetIds: [imageId],
    });
    assert.equal(revisionResult.ok, true);
    assert.equal(
      artifacts.commit({
        id: artifact.artifact.id,
        expectedHeadRevisionId: firstRevision.id,
        source: '# Overwrite from stale editor',
      }).ok,
      false,
    );
    assert.equal(artifacts.view(artifact.artifact.id).revisions.length, 2);

    const organization = new OrganizationService(active().db);
    const tag = organization.createTag('Lighthouse research');
    organization.setConversationTags(chat.id, [tag.id]);
    const template = organization.savePromptTemplate({
      name: 'Review sources',
      body: 'Review each cited source.',
      projectId: project.id,
    });
    const branch = active().branch(chat.id, turn.assistantId);
    assert.deepEqual(active().messages(branch.id)[0].contextSources, sources);
    assert.equal(
      active().messages(branch.id)[0].artifactReferences?.[0].revisionId,
      firstRevision.id,
    );
    assert.deepEqual(organization.conversationTags(branch.id), [tag]);
    const fork = artifacts.fork({ id: artifact.artifact.id, revisionId: firstRevision.id });
    assert.equal(fork.revisions[0].source, firstRevision.source);
    artifacts.commit({
      id: fork.artifact.id,
      expectedHeadRevisionId: fork.artifact.headRevisionId,
      source: '# Branch-only changes',
    });
    assert.equal(
      artifacts.view(artifact.artifact.id).revisions[0].source,
      '# Accepted revision two',
    );

    const comparison = new ComparisonStore(active());
    const group = comparison.create(
      {
        requestId: randomUUID(),
        sourceConversationId: chat.id,
        text: 'Compare the report',
        attachments: [image],
        contextRefs: refs,
        targets: [
          { providerId: 'openai', model: 'fixture-one' },
          { providerId: 'compatible', model: 'fixture-two' },
        ],
        pdfDelivery: 'text',
      },
      active().messages(chat.id),
      ['fixture-revision-one', 'fixture-revision-two'],
    );
    for (const member of group.members) {
      assert.deepEqual(active().messages(member.conversationId)[0].contextSources, sources);
      assert.equal(
        active().messages(member.conversationId)[0].artifactReferences?.[0].revisionId,
        firstRevision.id,
      );
      assert.deepEqual(active().draft(member.conversationId)?.attachments, [image]);
    }
    comparison.markStarted(group.id);
    const firstMember = group.members[0];
    const comparisonTurn = active().startTurn(
      firstMember.conversationId,
      active().lastSession(firstMember.conversationId)!,
      firstMember.requestId,
      'Compare the report',
    );
    active().event(
      comparisonTurn.turn,
      'text',
      {},
      { id: comparisonTurn.assistantId, delta: 'Partial comparison result.' },
    );

    // Reopening marks active lanes interrupted and keeps untouched lanes unsent.
    active().close();
    store = new Store(database, migrations);
    assert.deepEqual(active().messages(chat.id)[0].contextSources, sources);
    assert.equal(
      new ArtifactsStore(active().db).view(artifact.artifact.id).draft?.source,
      '# Unfinished edit',
    );
    const reopenedComparison = new ComparisonStore(active()).read(group.id);
    assert.equal(reopenedComparison.members[0].status, 'interrupted');
    assert.equal(reopenedComparison.members[0].text, 'Partial comparison result.');
    assert.equal(active().messages(group.members[1].conversationId).length, 2);
    assert.equal(active().draft(group.members[1].conversationId)?.text, 'Compare the report');
    assert.ok(
      new OrganizationService(active().db)
        .promptTemplates(project.id)
        .some((t) => t.id === template.id),
    );

    const unsentSource = new ContextStore(active()).createSnapshot({
      itemId: null,
      revision: 1,
      kind: 'memory',
      title: 'Unsent preference',
      text: 'Do not lose this unsent context.',
      projectId: null,
    });
    active().saveDraft(branch.id, {
      text: 'Unsent draft with snapshots and artifact',
      attachments: [image],
      provider: 'openai',
      model: 'fixture-model',
      mode: 'chat',
      effort: '',
      contextRefs: [{ snapshotId: unsentSource.id, included: true }],
      artifactReferences: [{ artifactId: artifact.artifact.id, revisionId: firstRevision.id }],
      historyMessageIds: active()
        .messages(branch.id)
        .map((message) => message.id),
    });
    const exported = active().exportData(branch.id);
    assert.deepEqual(
      exported.artifacts[0].revisions.map((revision) => revision.id),
      [firstRevision.id],
    );
    assert.equal(exported.artifacts[0].headRevisionId, firstRevision.id);
    assert.deepEqual(
      new Set(exported.assets.map((a) => (a as { id: string }).id)),
      new Set([imageId, pdfId]),
    );
    assert.equal((await embeddedAssets(directory, exported.assets)).length, 2);
    assert.ok(!JSON.stringify(exported).includes(credential));
    const portable = structuredClone(exported);
    const sourceIds = new Map(
      [...sources, ...exported.contextSnapshots].map((source) => [source.id, randomUUID()]),
    );
    for (const message of portable.messages)
      message.contextSources = message.contextSources?.map((source) => ({
        ...source,
        id: sourceIds.get(source.id)!,
        itemId: null,
        projectId: null,
      }));
    if (portable.draft?.contextRefs)
      portable.draft.contextRefs = portable.draft.contextRefs.map((ref) => ({
        ...ref,
        snapshotId: sourceIds.get(ref.snapshotId)!,
      }));
    portable.contextSnapshots = portable.contextSnapshots.map((source) => ({
      ...source,
      id: sourceIds.get(source.id)!,
      itemId: null,
      projectId: null,
    }));
    const imported = active().importData(portable);
    const importedSources = sources.map((source) => ({
      ...source,
      id: sourceIds.get(source.id)!,
      itemId: null,
      projectId: null,
    }));
    assert.deepEqual(active().messages(imported.id)[0].contextSources, importedSources);
    const importedReference = active().messages(imported.id)[0].artifactReferences![0];
    assert.notEqual(importedReference.artifactId, artifact.artifact.id);
    assert.notEqual(importedReference.revisionId, firstRevision.id);
    assert.equal(
      new ArtifactsStore(active().db).revision(
        importedReference.artifactId,
        importedReference.revisionId,
      ).source,
      firstRevision.source,
    );
    const importedDraft = active().draft(imported.id)!;
    assert.equal(importedDraft.text, 'Unsent draft with snapshots and artifact');
    assert.deepEqual(importedDraft.attachments, [image]);
    assert.deepEqual(importedDraft.artifactReferences, [
      { artifactId: importedReference.artifactId, revisionId: importedReference.revisionId },
    ]);
    assert.deepEqual(
      importedDraft.historyMessageIds,
      active()
        .messages(imported.id)
        .map((message) => message.id),
    );
    assert.equal(
      new ContextStore(active()).snapshot(importedDraft.contextRefs![0].snapshotId).text,
      unsentSource.text,
    );
    assert.deepEqual(
      new OrganizationService(active().db).conversationTags(imported.id).map((t) => t.name),
      [tag.name],
    );
    const importedContext = new ContextStore(active()).resolve(
      importedSources.map((s) => ({ snapshotId: s.id, included: true })),
      null,
      imported.id,
    );
    assert.deepEqual(importedContext, importedSources);

    const backup = join(directory, 'features.backup.gz');
    await writeBackup(host, directory, backup);
    const bytes = await readFile(backup);
    const envelope = JSON.parse((await expand(bytes)).toString('utf8'));
    assert.ok(!JSON.stringify(envelope).includes(credential));
    const prepared = await prepareRestore(host, directory, backup);
    active().rename(chat.id, 'Changed after backup');
    await installRestore(host, directory, prepared);
    assert.notEqual(active().conversation(chat.id).title, 'Changed after backup');
    assert.deepEqual(active().messages(chat.id)[0].contextSources, sources);
    assert.equal(
      new ContextStore(active()).item(updatedInstructions.id).text,
      updatedInstructions.text,
    );
    assert.equal(
      new ArtifactsStore(active().db).view(artifact.artifact.id).draft?.source,
      '# Unfinished edit',
    );
    assert.equal(
      new ComparisonStore(active()).read(group.id).members[0].text,
      'Partial comparison result.',
    );
    assert.equal(
      new OrganizationService(active().db).promptTemplates(project.id)[0].body,
      template.body,
    );
    assert.deepEqual(await readFile(join(directory, 'assets', imageId)), imageBytes);
    assert.deepEqual(await readFile(join(directory, 'assets', pdfId)), pdfBytes);
    assert.equal(await readFile(join(directory, 'credentials', 'openai'), 'utf8'), credential);

    // Corrupt newer tables must be rejected in the temporary profile, before replacement.
    async function rejectedBackup(name: string, mutate: (db: Database.Database) => void) {
      const edited = structuredClone(envelope);
      const temporaryDb = join(directory, `${name}.sqlite`);
      await writeFile(temporaryDb, Buffer.from(edited.database, 'base64'));
      const db = new Database(temporaryDb);
      try {
        db.pragma('foreign_keys=OFF');
        mutate(db);
      } finally {
        db.close();
      }
      edited.database = (await readFile(temporaryDb)).toString('base64');
      const path = join(directory, `${name}.backup.gz`);
      await writeFile(path, await compress(Buffer.from(JSON.stringify(edited))));
      await assert.rejects(() => prepareRestore(host, directory, path));
      assert.deepEqual(active().messages(chat.id)[0].contextSources, sources);
      assert.equal(
        new ComparisonStore(active()).read(group.id).members[0].text,
        'Partial comparison result.',
      );
    }
    await rejectedBackup('missing-context-table', (db) => db.exec('DROP TABLE context_snapshots'));
    await rejectedBackup('malformed-context-snapshot', (db) =>
      db.prepare("UPDATE context_snapshots SET content='{}' WHERE id=?").run(web.id),
    );
    await rejectedBackup('missing-artifact-head', (db) =>
      db
        .prepare('UPDATE artifacts SET head_revision_id=? WHERE id=?')
        .run(randomUUID(), artifact.artifact.id),
    );
    await rejectedBackup('future-schema', (db) =>
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(999, new Date().toISOString()),
    );

    console.log(
      'Feature acceptance passed: populated v4 migration, folderless projects, immutable knowledge/memory/web snapshots, scoped defaults, stale revision rejection, branching, artifact forks/drafts, comparison interruption, exports with referenced assets, WAL profile restore, and corrupt feature-table rejection.',
    );
  } finally {
    store?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

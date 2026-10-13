import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from '../../src/runtime/storage/store';
import { ContextStore } from '../../src/runtime/context/storage';
import { createContextHandlers } from '../../src/runtime/context';
import { contextSnapshotSchema } from '../../src/shared/context';

export async function contextAcceptance(directory: string, migrations: string) {
  const store = new Store(join(directory, 'context-acceptance.sqlite'), migrations);
  try {
    const context = new ContextStore(store);
    const project = store.createChatProject('Travel plans');
    const other = store.createChatProject('Other project');
    assert.equal(project.kind, 'chat');
    assert.equal(project.path, null);
    assert.equal(project.workspaceId, null);
    assert.equal(store.workspaces().length, 0);
    assert.throws(() => store.trustProject(project.id, true), /directory/);
    assert.throws(() => store.resolveWorkspace(project.id), /not found/);
    const instructions = context.save({
      projectId: project.id,
      kind: 'instructions',
      title: 'Travel instructions',
      text: 'Prefer rail travel.',
    });
    const note = context.save({
      projectId: project.id,
      kind: 'note',
      title: 'Trip budget',
      text: 'Budget is 600 euros.',
      includeInNewChats: true,
    });
    const defaults = context.projectDefaults(project.id);
    assert.equal(defaults.length, 2);
    const captures = context.resolve(defaults, project.id);
    const capturedNote = captures.find((source) => source.itemId === note.id)!;
    context.save({ ...note, text: 'Budget is 900 euros.', expectedRevision: note.revision });
    assert.throws(
      () => context.resolve([{ snapshotId: capturedNote.id, included: true }], project.id),
      /changed/,
    );
    assert.equal(
      context.resolve(
        [{ snapshotId: capturedNote.id, included: true, reviewed: true }],
        project.id,
      )[0].text,
      'Budget is 600 euros.',
    );
    assert.throws(() => context.resolve(defaults, other.id), /another project/);
    assert.throws(() => context.save({ ...instructions, expectedRevision: 99 }), /changed/);
    const chat = store.createConversation(project.id);
    const session = store.session(chat.id, 'openai', '', 'chat');
    const turn = store.startTurn(
      chat.id,
      session,
      randomUUID(),
      'Plan the trip',
      '',
      '',
      [],
      captures,
    );
    store.finish(turn.turn, 'completed');
    context.save({
      ...instructions,
      text: 'Prefer buses.',
      expectedRevision: instructions.revision,
    });
    assert.equal(
      context
        .resolve(defaults, project.id, chat.id)
        .find((source) => source.kind === 'instructions')!.text,
      'Prefer rail travel.',
    );
    assert.equal(store.view(chat.id).currentSessionId, session.id);
    const summary = context
      .conversationSources(chat.id)
      .find((source) => source.id === capturedNote.id)!;
    assert.equal('text' in summary, false);
    assert.deepEqual(summary.messageIds, [turn.userId]);
    assert.deepEqual(summary.sessionIds, [session.id]);
    store.saveDraft(chat.id, {
      text: 'Original unsent draft',
      attachments: [],
      provider: 'openai',
      model: '',
      mode: 'chat',
      effort: '',
      contextRefs: defaults,
      historyMessageIds: [turn.userId, turn.assistantId],
      excludedContextSnapshotIds: [capturedNote.id],
    });
    const branch = store.branch(chat.id, turn.userId, true);
    const branchDraft = store.draft(branch.id)!;
    assert.equal(branchDraft.contextRefs!.length, captures.length);
    assert.equal(
      context
        .resolve(branchDraft.contextRefs!, project.id, branch.id)
        .find((source) => source.kind === 'instructions')!.text,
      'Prefer rail travel.',
    );
    assert.equal(store.messages(branch.id).length, 0);
    assert.deepEqual(branchDraft.historyMessageIds, []);
    assert.equal(store.draft(chat.id)!.text, 'Original unsent draft');
    const retained = store.branch(chat.id, turn.assistantId);
    assert.deepEqual(
      store.draft(retained.id)!.historyMessageIds,
      store.messages(retained.id).map((message) => message.id),
    );
    assert.ok(!store.draft(retained.id)!.historyMessageIds!.includes(turn.userId));
    const partial = store.startTurn(
      chat.id,
      session,
      randomUUID(),
      'Follow-up with a partial response',
    );
    store.event(
      partial.turn,
      'text',
      { text: 'Partial reply' },
      { id: partial.assistantId, delta: 'Partial reply' },
    );
    assert.throws(() => store.branch(chat.id, partial.assistantId), /completes/);
    store.finish(partial.turn, 'interrupted', 'Fixture interruption', {
      code: 'interrupted',
      message: 'Fixture interruption',
      retryable: true,
    });
    const partialBranch = store.branch(chat.id, partial.assistantId);
    const copiedPartial = store.messages(partialBranch.id).at(-1)!;
    assert.equal(copiedPartial.status, 'interrupted');
    assert.equal(copiedPartial.text, 'Partial reply');
    assert.equal(copiedPartial.errorInfo!.message, 'Fixture interruption');
    assert.equal(store.conversation(partialBranch.id).lastStatus, 'interrupted');
    context.remove(note.id, 2);
    assert.equal(context.snapshot(capturedNote.id).text, 'Budget is 600 euros.');
    assert.equal(context.resolve(defaults, project.id, chat.id).length, 2);

    const assetId = randomUUID();
    const bytes = Buffer.from('%PDF-1.4\nfixture');
    await mkdir(join(directory, 'assets'), { recursive: true });
    await writeFile(join(directory, 'assets', assetId), bytes);
    store.registerAsset({
      id: assetId,
      mime: 'application/pdf',
      type: 'pdf',
      size: bytes.length,
      hash: createHash('sha256').update(bytes).digest('hex'),
    });
    const document = context.save({
      projectId: project.id,
      kind: 'document',
      title: 'Itinerary',
      text: 'Day one in Copenhagen.',
      attachment: {
        path: 'itinerary.pdf',
        name: 'itinerary.pdf',
        kind: 'pdf',
        assetId,
        content: 'Day one in Copenhagen.',
        delivery: 'text',
      },
    });
    const pendingRefs = context.snapshotItems([document.id]);
    const unusedSnapshot = context.createSnapshot({
      itemId: null,
      projectId: project.id,
      revision: 1,
      kind: 'note',
      title: 'Removed pending source',
      text: 'This source was never shared.',
    });
    const meaningfulExclusions = [capturedNote.id, pendingRefs[0].snapshotId];
    store.saveDraft(chat.id, {
      text: 'Unsent follow-up',
      attachments: [],
      provider: 'openai',
      model: '',
      effort: '',
      mode: 'chat',
      contextRefs: pendingRefs,
      historyMessageIds: [turn.userId],
      excludedContextSnapshotIds: [...meaningfulExclusions, unusedSnapshot.id],
    });
    const exported = store.exportData(chat.id);
    assert.equal(exported.version, 2);
    assert.equal(exported.contextSnapshots.length, 1);
    assert.equal(exported.assets.find((asset) => asset.id === assetId)!.type, 'pdf');
    assert.equal(exported.draft!.text, 'Unsent follow-up');
    assert.deepEqual(exported.draft!.excludedContextSnapshotIds, meaningfulExclusions);
    assert.deepEqual(store.draft(chat.id)!.excludedContextSnapshotIds, [
      ...meaningfulExclusions,
      unusedSnapshot.id,
    ]);
    const remapped = new Map(
      [...captures, ...exported.contextSnapshots].map((snapshot) => [snapshot.id, randomUUID()]),
    );
    const copy = (snapshot: (typeof captures)[number]) =>
      contextSnapshotSchema.parse({ ...snapshot, id: remapped.get(snapshot.id)! });
    const imported = store.importData({
      ...exported,
      messages: exported.messages.map((message) => ({
        ...message,
        contextSources: message.contextSources?.map(copy),
      })),
      contextSnapshots: exported.contextSnapshots.map(copy),
      draft: {
        ...exported.draft!,
        contextRefs: exported.draft!.contextRefs!.map((ref) => ({
          ...ref,
          snapshotId: remapped.get(ref.snapshotId)!,
        })),
        excludedContextSnapshotIds: exported.draft!.excludedContextSnapshotIds!.map((id) =>
          remapped.get(id)!,
        ),
      },
    });
    const importedDraft = store.draft(imported.id)!;
    assert.equal(importedDraft.text, 'Unsent follow-up');
    assert.deepEqual(
      importedDraft.excludedContextSnapshotIds,
      meaningfulExclusions.map((id) => remapped.get(id)!),
    );
    assert.equal(importedDraft.historyMessageIds![0], store.messages(imported.id)[0].id);
    assert.equal(
      context.resolve(importedDraft.contextRefs!, null, imported.id)[0].text,
      document.text,
    );
    assert.equal(context.resolve(importedDraft.contextRefs!, null, imported.id)[0].projectId, null);
    assert.equal(
      store
        .messages(imported.id)[0]
        .contextSources!.find((source) => source.kind === 'instructions')!.text,
      'Prefer rail travel.',
    );
    const beforeInvalidImport = store.conversations().length;
    const invalid = {
      ...store.exportData(imported.id),
      draft: { ...importedDraft, historyMessageIds: [randomUUID()] },
    };
    assert.throws(() => store.importData(invalid), /history message/);
    assert.equal(store.conversations().length, beforeInvalidImport);
    assert.throws(
      () =>
        store.importData({
          ...store.exportData(imported.id),
          draft: { ...importedDraft, excludedContextSnapshotIds: [randomUUID()] },
        }),
      /excluded source/,
    );
    assert.equal(store.conversations().length, beforeInvalidImport);

    store.removeProject(project.id);
    assert.equal(store.conversation(chat.id).projectId, null);
    assert.equal(context.resolve(defaults, null, chat.id).length, 2);
    const personalBranch = store.branch(chat.id, turn.userId, true);
    const personalDraft = store.draft(personalBranch.id)!;
    const personalNote = context
      .resolve(personalDraft.contextRefs!, null, personalBranch.id)
      .find((source) => source.kind === 'note')!;
    assert.notEqual(personalNote.id, capturedNote.id);
    assert.equal(personalNote.projectId, null);
    assert.deepEqual(personalDraft.excludedContextSnapshotIds, [personalNote.id]);
    assert.deepEqual(store.draft(chat.id)!.excludedContextSnapshotIds, [
      ...meaningfulExclusions,
      unusedSnapshot.id,
    ]);
    assert.throws(
      () => context.resolve(defaults, null, store.createConversation().id),
      /another project/,
    );
    assert.equal(context.items(null, 'memory').length, 0);
    const handlers = createContextHandlers(store);
    assert.throws(
      () =>
        handlers.saveContextItem({
          projectId: null,
          kind: 'web',
          title: 'Forged fetched page',
          text: 'Not fetched.',
        }),
      /Capture web/,
    );
    const fresh = store.session(chat.id, 'openai', '', 'chat', undefined, true);
    assert.notEqual(fresh.id, session.id);
    assert.equal(fresh.nativeId, null);
    console.log(
      'Context acceptance passed: chat projects, CAS edits, frozen snapshots, stale review, source scope, historical pins, independent library assets, branches, draft/export/import preservation and fresh sessions.',
    );
  } finally {
    store.close();
  }
}

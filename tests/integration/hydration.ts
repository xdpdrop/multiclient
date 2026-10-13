import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '../../src/runtime/storage/store';
import { ArtifactsStore, linkArtifactRevision } from '../../src/runtime/artifacts/store';

export function hydrationAcceptance(directory: string, migrations: string) {
  const store = new Store(join(directory, 'hydration-acceptance.sqlite'), migrations);
  try {
    const conversation = store.createConversation();
    const session = store.session(conversation.id, 'openai', '', 'chat');
    const runs = store.db.transaction(() =>
      Array.from({ length: 501 }, (_, index) => {
        const run = store.startTurn(
          conversation.id,
          session,
          randomUUID(),
          `Hydration prompt ${index}`,
          `Captured context ${index}`,
          '',
          [{ path: `note-${index}.txt`, kind: 'text', content: `Note ${index}` }],
        );
        store.event(
          run.turn,
          'text',
          {},
          {
            id: run.assistantId,
            itemId: `answer-${index}`,
            phase: 'answer',
            delta: `Hydrated answer ${index}`,
          },
        );
        store.finish(
          run.turn,
          index === 500 ? 'interrupted' : 'completed',
          index === 500 ? 'Fixture interruption' : undefined,
          index === 500
            ? { code: 'interrupted', message: 'Fixture interruption', retryable: true }
            : undefined,
        );
        return run;
      }),
    )();
    const artifact = new ArtifactsStore(store.db).create({
      title: 'Batch hydration document',
      kind: 'markdown',
      source: '# Exact revision',
      originConversationId: conversation.id,
      originMessageId: runs[0].userId,
    }).artifact;
    for (const [run, relation] of [
      [runs[250], 'context'],
      [runs[500], 'proposal'],
    ] as const)
      linkArtifactRevision(store.db, {
        conversationId: conversation.id,
        messageId: relation === 'proposal' ? run.assistantId : run.userId,
        artifactId: artifact.id,
        revisionId: artifact.headRevisionId,
        relation,
      });

    const queries: string[] = [];
    const prepare = store.db.prepare.bind(store.db);
    store.db.prepare = ((sql: string) => {
      if (
        /FROM message_blocks WHERE message_id|FROM message_artifacts ma|FROM turns WHERE id/.test(
          sql,
        )
      )
        queries.push(sql);
      return prepare(sql);
    }) as typeof store.db.prepare;
    let messages;
    try {
      messages = store.messages(conversation.id);
    } finally {
      store.db.prepare = prepare;
    }
    assert.equal(messages.length, 1002);
    assert.equal(queries.length, 9, 'Hydration should issue three queries per 500-message chunk.');
    assert.ok(
      queries.every((query) => / IN \(/.test(query)),
      'No per-message hydration queries.',
    );
    const expected = (relation: string) => [
      {
        artifactId: artifact.id,
        revisionId: artifact.headRevisionId,
        relation,
        title: artifact.title,
        number: 1,
      },
    ];
    assert.deepEqual(messages[0].artifactReferences, expected('created'));
    assert.deepEqual(messages[500].artifactReferences, expected('context'));
    assert.deepEqual(messages[1001].artifactReferences, expected('proposal'));
    assert.deepEqual(messages[501].artifactReferences, []);
    assert.equal(messages[1000].context, 'Captured context 500');
    assert.equal(messages[1000].attachments![0].content, 'Note 500');
    assert.deepEqual(messages[1001].blocks, [
      { id: 'answer-500', phase: 'answer', text: 'Hydrated answer 500' },
    ]);
    assert.equal(messages[1001].errorInfo!.message, 'Fixture interruption');
    assert.deepEqual(store.transcript(session.id), messages);
    const latest = store.view(conversation.id).messages;
    assert.equal(latest.length, 100);
    assert.deepEqual(latest.at(-1)!.artifactReferences, expected('proposal'));

    const branch = store.branch(conversation.id, runs[500].assistantId);
    const branched = store.messages(branch.id);
    assert.deepEqual(branched[0].artifactReferences, expected('created'));
    assert.deepEqual(branched[500].artifactReferences, expected('context'));
    assert.deepEqual(branched[1001].artifactReferences, expected('proposal'));
    assert.equal(branched[1001].errorInfo!.message, 'Fixture interruption');

    const imported = store.importData(store.exportData(conversation.id));
    const importedMessages = store.messages(imported.id);
    for (const [index, relation] of [
      [0, 'created'],
      [500, 'context'],
      [1001, 'proposal'],
    ] as const) {
      const reference = importedMessages[index].artifactReferences![0];
      assert.notEqual(reference.artifactId, artifact.id);
      assert.notEqual(reference.revisionId, artifact.headRevisionId);
      assert.deepEqual(reference, {
        ...expected(relation)[0],
        artifactId: reference.artifactId,
        revisionId: reference.revisionId,
      });
    }
    assert.equal(importedMessages[1001].errorInfo!.message, 'Fixture interruption');
    console.log(
      'Batch hydration acceptance passed: 1,002 messages, nine hydration queries, exact created/context/proposal references, blocks/errors, pagination, branches and portable import.',
    );
  } finally {
    store.close();
  }
}

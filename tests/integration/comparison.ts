import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Store } from '../../src/runtime/storage/store';
import { Coordinator } from '../../src/runtime/conversations/coordinator';
import { Comparisons } from '../../src/runtime/comparison';
import { ComparisonStore } from '../../src/runtime/comparison/store';
import { ContextStore } from '../../src/runtime/context/storage';
import { ArtifactsStore, linkArtifactRevision } from '../../src/runtime/artifacts/store';
import { validateDatabase } from '../../src/runtime/storage/backup';
import type { ComparisonInput } from '../../src/shared/comparison';
import type { Attachment } from '../../src/shared/types';
import { waitFor } from '../wait-for';

async function settle(coordinator: Coordinator) {
  await waitFor(() => coordinator.activeTurns().length === 0, 5000).catch(() => {
    throw new Error('Comparison fixture did not finish.');
  });
}
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-comparison-'));
  const database = join(directory, 'profile.sqlite');
  let store = new Store(database, resolve('migrations'));
  const originalFetch = globalThis.fetch;
  try {
    await mkdir(join(directory, 'assets'));
    store.saveConnection({
      ...store.connection('compatible'),
      endpoint: 'http://localhost:11434/v1',
      model: 'model-one',
      enabled: true,
      configured: true,
    });
    const project = store.createChatProject('Research project');
    const library = new ContextStore(store);
    const instructions = library.save({
      projectId: project.id,
      kind: 'instructions',
      title: 'Project instructions',
      text: 'Use these pinned instructions.',
    });
    const knowledge = library.save({
      projectId: project.id,
      kind: 'note',
      title: 'Brief',
      text: 'The original brief.',
    });
    const refs = library.snapshotItems([instructions.id, knowledge.id]);
    const sources = refs.map((ref) => library.snapshot(ref.snapshotId));
    const assetId = randomUUID();
    const pdf = Buffer.from('%PDF-fixture');
    await writeFile(join(directory, 'assets', assetId), pdf);
    store.registerAsset({
      id: assetId,
      mime: 'application/pdf',
      type: 'pdf',
      size: pdf.length,
      hash: createHash('sha256').update(pdf).digest('hex'),
    });
    const attachment: Attachment = {
      kind: 'pdf',
      delivery: 'text',
      path: 'brief.pdf',
      name: 'brief.pdf',
      assetId,
      mime: 'application/pdf',
      content: 'Selected PDF page one',
      pages: [{ page: 1, text: 'Selected PDF page one' }],
    };
    const source = store.createConversation(project.id);
    const session = store.session(source.id, 'compatible', 'model-one', 'chat');
    const first = store.startTurn(
      source.id,
      session,
      randomUUID(),
      'Original question',
      '',
      '',
      [attachment],
      sources,
    );
    store.event(
      first.turn,
      'text',
      { text: 'Original answer' },
      { id: first.assistantId, delta: 'Original answer' },
    );
    store.finish(first.turn, 'completed');
    const selected = store.messages(source.id);
    const artifacts = new ArtifactsStore(store.db);
    const artifact = artifacts.create({
      title: 'Report',
      kind: 'markdown',
      source: 'Version one',
      projectId: project.id,
      originConversationId: source.id,
      originMessageId: first.assistantId,
    });
    linkArtifactRevision(store.db, {
      conversationId: source.id,
      messageId: first.assistantId,
      artifactId: artifact.artifact.id,
      revisionId: artifact.artifact.headRevisionId,
      relation: 'created',
    });
    const later = store.startTurn(
      source.id,
      session,
      randomUUID(),
      'Later history must be excluded',
    );
    store.finish(later.turn, 'completed');
    library.save({
      ...instructions,
      expectedRevision: instructions.revision,
      text: 'These later instructions must not replace the pinned version.',
    });
    const requests: { model: string; messages: { role: string; content: unknown }[] }[] = [];
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      requests.push(request);
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: `Answer from ${request.model}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })}\n\n`,
      );
    };
    const coordinator = new Coordinator(
      store,
      directory,
      '',
      () => {},
      async () => 'fixture-secret',
    );
    const service = new Comparisons({
      store,
      coordinator,
      dataDir: directory,
      secret: async () => 'fixture-secret',
      changed: () => {},
    });
    const input: ComparisonInput = {
      requestId: randomUUID(),
      sourceConversationId: source.id,
      historyMessageIds: selected.map((m) => m.id),
      text: 'Give another answer',
      attachments: [],
      targets: [
        { providerId: 'compatible', model: 'model-one' },
        { providerId: 'compatible', model: 'model-two' },
      ],
      pdfDelivery: 'text',
      artifactReferences: [
        { artifactId: artifact.artifact.id, revisionId: artifact.artifact.headRevisionId },
      ],
    };
    const prepared = await service.prepare(input);
    assert.equal(requests.length, 0);
    for (const member of prepared.members) {
      const copied = store.messages(member.conversationId);
      assert.equal(copied.length, selected.length);
      assert.notEqual(copied[0].id, selected[0].id);
      assert.deepEqual(copied[0].contextSources, sources);
      assert.equal(copied[0].attachments?.[0].delivery, 'text');
      assert.equal(
        store.db
          .prepare('SELECT COUNT(*) AS n FROM message_assets WHERE message_id=?')
          .get(copied[0].id) &&
          (
            store.db
              .prepare('SELECT COUNT(*) AS n FROM message_assets WHERE message_id=?')
              .get(copied[0].id) as { n: number }
          ).n,
        1,
      );
      assert.equal(
        (
          store.db
            .prepare('SELECT COUNT(*) AS n FROM message_artifacts WHERE message_id=?')
            .get(copied[1].id) as { n: number }
        ).n,
        1,
      );
    }
    await Promise.all([service.start(prepared.id), service.start(prepared.id)]);
    await settle(coordinator);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].messages, requests[1].messages);
    const delivered = JSON.stringify(requests[0].messages);
    assert.match(delivered, /Use these pinned instructions/);
    assert.match(delivered, /The original brief/);
    assert.match(delivered, /Selected PDF page one/);
    assert.match(delivered, /Version one/);
    assert.doesNotMatch(delivered, /Later history must be excluded|These later instructions/);
    const completed = service.read(prepared.id);
    assert.ok(completed.members.every((member) => member.status === 'completed'));
    assert.equal(completed.members[0].usage?.totalTokens, 7);
    const branch = service.continue(prepared.id, completed.members[0].conversationId);
    assert.equal(branch.parentConversationId, completed.members[0].conversationId);
    assert.equal(store.messages(source.id).length, selected.length + 2);
    assert.ok(store.messages(branch.id).some((m) => m.text === 'Answer from model-one'));
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      requests.push(request);
      if (request.model === 'model-one') {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: 'Saved partial response' } }] })}\n\n`,
              ),
            );
            options?.signal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          },
        });
        return new Response(stream);
      }
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Independent completed response' }, finish_reason: 'stop' }] })}\n\n`,
      );
    };
    const cancellation = await service.prepare({ ...input, requestId: randomUUID() });
    await service.start(cancellation.id);
    await waitFor(() => requests.length >= 4, 5000).catch(() => {
      assert.fail('Both cancellation lanes must start.');
    });
    await service.cancel(cancellation.id, cancellation.members[0].conversationId);
    await settle(coordinator);
    const cancelled = service.read(cancellation.id);
    assert.equal(cancelled.members[0].status, 'cancelled');
    assert.equal(cancelled.members[0].text, 'Saved partial response');
    assert.equal(cancelled.members[1].status, 'completed');
    assert.equal(cancelled.members[1].text, 'Independent completed response');
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      requests.push(request);
      if (request.model === 'model-one') return new Response('', { status: 429 });
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Unaffected by another model quota' }, finish_reason: 'stop' }] })}\n\n`,
      );
    };
    const failure = await service.prepare({ ...input, requestId: randomUUID() });
    await service.start(failure.id);
    await settle(coordinator);
    assert.equal(service.read(failure.id).members[0].status, 'failed');
    assert.match(service.read(failure.id).members[0].error ?? '', /usage limit/);
    assert.equal(service.read(failure.id).members[1].status, 'completed');
    const waiting = await service.prepare({ ...input, requestId: randomUUID() });
    assert.equal(requests.length, 6);
    const backup = join(directory, 'backup.sqlite');
    await store.backup(backup);
    validateDatabase(backup);
    const restored = new Store(backup, resolve('migrations'));
    assert.equal(
      new ComparisonStore(restored).read(prepared.id).members[0].text,
      'Answer from model-one',
    );
    assert.equal(new ComparisonStore(restored).read(waiting.id).state, 'prepared');
    restored.close();
    store.close();
    store = new Store(database, resolve('migrations'));
    const restartedCoordinator = new Coordinator(
      store,
      directory,
      '',
      () => {},
      async () => 'fixture-secret',
    );
    const restarted = new Comparisons({
      store,
      coordinator: restartedCoordinator,
      dataDir: directory,
      secret: async () => 'fixture-secret',
      changed: () => {},
    });
    await assert.rejects(restarted.start(waiting.id), /preparation expired/);
    assert.equal(requests.length, 6);
    assert.equal(store.draft(waiting.members[0].conversationId)?.text, input.text);
    assert.equal(
      new ComparisonStore(store).read(prepared.id).members[1].text,
      'Answer from model-two',
    );
    console.log(
      'Comparison integration passed: SQLite clone/provenance/assets/artifacts, frozen requests, independent chats, branching, backup and restart without replay.',
    );
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('multiclient-comparison-'));
    await rm(directory, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../src/runtime/storage/store';
import {
  ArtifactsStore,
  resolveArtifactContext,
  linkArtifactRevision,
  copyArtifactReferences,
  messageArtifactReferences,
  exportConversationArtifacts,
  importConversationArtifacts,
  importArtifactBundle,
} from '../../src/runtime/artifacts/store';

const directory = mkdtempSync(join(tmpdir(), 'multiclient-artifacts-'));
const path = join(directory, 'test.sqlite');
let store = new Store(path, resolve('migrations'));
try {
  let artifacts = new ArtifactsStore(store.db);
  const project = store.addProject(directory),
    other = store.addProject(join(directory, 'other'));
  const c = store.createConversation(project.id),
    session = store.session(c.id, 'codex', '', 'ask');
  const run = store.startTurn(c.id, session, randomUUID(), 'Make a document');
  store.finish(run.turn, 'completed');
  const messageId = store.messages(c.id)[0].id;
  const created = artifacts.create({
    title: 'Document',
    kind: 'markdown',
    source: '# Original',
    projectId: project.id,
    originConversationId: c.id,
    originMessageId: messageId,
  });
  const id = created.artifact.id,
    initial = created.artifact.headRevisionId;
  const draft = artifacts.saveDraft({
    id,
    baseRevisionId: initial,
    source: '# Recovered draft',
    expectedGeneration: 0,
  });
  assert.equal(draft.ok, true);
  assert.equal(
    artifacts.saveDraft({
      id,
      baseRevisionId: initial,
      source: 'Lost update',
      expectedGeneration: 0,
    }).ok,
    false,
  );
  store.close();
  store = new Store(path, resolve('migrations'));
  artifacts = new ArtifactsStore(store.db);
  assert.equal(artifacts.view(id).draft?.source, '# Recovered draft');
  const saved = artifacts.commit({
    id,
    expectedHeadRevisionId: initial,
    source: '# Recovered draft',
  });
  assert.equal(saved.ok, true);
  assert.equal(artifacts.revision(id, initial).source, '# Original');
  assert.equal(artifacts.view(id).draft, null);
  assert.equal(
    artifacts.commit({ id, expectedHeadRevisionId: initial, source: 'Lost revision' }).ok,
    false,
  );
  const latest = artifacts.view(id).artifact.headRevisionId;
  assert.match(
    resolveArtifactContext(store.db, [{ artifactId: id, revisionId: initial }], c.id),
    /# Original/,
  );
  assert.doesNotMatch(
    resolveArtifactContext(store.db, [{ artifactId: id, revisionId: initial }], c.id),
    /Recovered draft/,
  );
  assert.throws(
    () =>
      resolveArtifactContext(
        store.db,
        [{ artifactId: id, revisionId: initial }],
        store.createConversation(other.id).id,
      ),
    /different project/,
  );
  assert.throws(() => artifacts.revision(id, randomUUID()), /does not belong/);
  const run2 = store.startTurn(c.id, session, randomUUID(), 'Use the original');
  store.finish(run2.turn, 'completed');
  const secondMessage = store.messages(c.id)[2].id;
  copyArtifactReferences(store.db, messageId, secondMessage);
  assert.equal(messageArtifactReferences(store.db, secondMessage)[0].revisionId, initial);
  const portable = exportConversationArtifacts(store.db, c.id);
  assert.equal(portable[0].headRevisionId, initial);
  assert.equal(portable[0].revisions.length, 1);
  const draftOnly = artifacts.create({
    title: 'Unsent draft artifact',
    kind: 'text',
    source: 'Pinned unsent source',
    projectId: project.id,
  });
  const draftClosure = exportConversationArtifacts(store.db, c.id, [
    { artifactId: draftOnly.artifact.id, revisionId: draftOnly.artifact.headRevisionId },
  ]);
  assert.equal(draftClosure.find((a) => a.id === draftOnly.artifact.id)?.references.length, 0);
  assert.equal(
    draftClosure.find((a) => a.id === draftOnly.artifact.id)?.revisions[0].source,
    'Pinned unsent source',
  );
  const fork = artifacts.fork({ id, revisionId: initial, projectId: null });
  assert.equal(fork.revisions[0].source, '# Original');
  assert.notEqual(fork.artifact.id, id);
  const restored = artifacts.restore({ id, revisionId: initial, expectedHeadRevisionId: latest });
  assert.equal(restored.ok, true);
  assert.equal(artifacts.view(id).revisions.length, 3);
  const importedConversation = store.createConversation();
  const importedSession = store.session(importedConversation.id, 'codex', '', 'ask');
  const importedRun = store.startTurn(
    importedConversation.id,
    importedSession,
    randomUUID(),
    'Imported message',
  );
  store.finish(importedRun.turn, 'completed');
  const importedMessage = store.messages(importedConversation.id)[0].id;
  const map = new Map([
    [messageId, importedMessage],
    [secondMessage, importedMessage],
  ]);
  const artifactExport = { ...portable[0], references: [portable[0].references[0]] };
  const imported = importConversationArtifacts(store.db, [artifactExport], map).get(id)!;
  assert.notEqual(imported.id, id);
  assert.equal(artifacts.view(imported.id).revisions[0].source, '# Original');
  const before = artifacts.list().length;
  assert.throws(
    () =>
      importConversationArtifacts(
        store.db,
        [{ ...artifactExport, headRevisionId: randomUUID() }],
        map,
      ),
    /reference/,
  );
  assert.equal(artifacts.list().length, before);
  const standalone = importArtifactBundle(
    store.db,
    {
      format: 'multiclient-artifact',
      version: 1,
      artifact: { ...artifactExport, references: [] },
      draft: { baseRevisionId: initial, source: 'Portable recovered draft' },
    },
    [],
  );
  assert.equal(standalone.draft?.source, 'Portable recovered draft');
  const unowned = randomUUID();
  store.registerAsset({
    id: unowned,
    mime: 'image/png',
    type: 'image',
    size: 1,
    hash: 'a'.repeat(64),
  });
  assert.throws(
    () =>
      artifacts.create({
        title: 'Leak',
        kind: 'html',
        source: `<img src="media://assets/${unowned}">`,
      }),
    /not associated/,
  );
  assert.throws(
    () => artifacts.create({ title: 'Huge', kind: 'text', source: '🌍'.repeat(25001) }),
    /100 KB/,
  );
  store.db.prepare('INSERT INTO message_assets VALUES (?,?)').run(messageId, unowned);
  const owned = artifacts.create({
    title: 'Owned image',
    kind: 'svg',
    source: `<svg><image href="media://assets/${unowned}"/></svg>`,
    originConversationId: c.id,
    originMessageId: messageId,
  });
  assert.deepEqual(owned.revisions[0].assetIds, [unowned]);
  const oversized = randomUUID();
  store.registerAsset({
    id: oversized,
    mime: 'image/png',
    type: 'image',
    size: 26 * 1024 * 1024,
    hash: 'b'.repeat(64),
  });
  store.db.prepare('INSERT INTO message_assets VALUES (?,?)').run(messageId, oversized);
  assert.throws(
    () =>
      artifacts.create({
        title: 'Oversized image',
        kind: 'html',
        source: `<img src="media://assets/${oversized}">`,
        originConversationId: c.id,
        originMessageId: messageId,
      }),
    /unavailable/,
  );
  store.removeProject(project.id);
  assert.equal(artifacts.artifact(id).projectId, null);
  assert.equal(artifacts.revision(id, initial).source, '# Original');
  console.log('Artifact integration checks passed.');
} finally {
  store.close();
  rmSync(directory, { recursive: true, force: true });
}

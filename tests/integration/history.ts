import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { Store } from '../../src/runtime/storage/store';
import { validateDatabase, validateRestoredDatabase } from '../../src/runtime/storage/backup';
import {
  embeddedAssets,
  installRestore,
  markdownTranscript,
  prepareRestore,
  printTranscript,
  writeBackup,
} from '../../src/main/history';
import type { RuntimeHost } from '../../src/main/runtime';
import type { Attachment, Draft } from '../../src/shared/types';
import { contextAcceptance } from './context';
import { hydrationAcceptance } from './hydration';
import { SUPPORTED_SCHEMA_VERSION } from '../../src/shared/storage-version';

const compress = promisify(gzip);
const expand = promisify(gunzip);
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-history-test-'));
  const database = join(directory, 'multiclient.sqlite');
  const migrations = resolve('migrations');
  let store: Store | undefined;
  const timings: Record<string, number> = {};
  function active() {
    assert.ok(store);
    return store;
  }
  function measure(name: string, operation: () => unknown, count = 20) {
    const start = performance.now();
    for (let n = 0; n < count; n++) operation();
    timings[name] = Math.round(((performance.now() - start) / count) * 100) / 100;
  }
  let failNextStart = false;
  const host = {
    async request(route: string, input: any = {}) {
      if (route === 'backupData') return active().backup(input.path);
      if (route === 'validateBackup') return validateRestoredDatabase(input.path, migrations);
      if (route === 'snapshot') return { projects: active().projects() };
      if (route === 'trustProject') {
        active().trustProject(input.id, input.trusted);
        return;
      }
      throw new Error(`Unsupported fixture route ${route}`);
    },
    async stop() {
      store?.close();
      store = undefined;
    },
    async start() {
      if (failNextStart) {
        failNextStart = false;
        throw new Error('Simulated runtime startup failure');
      }
      store = new Store(database, migrations);
    },
  } as unknown as RuntimeHost;

  try {
    store = new Store(database, migrations);
    await mkdir(join(directory, 'assets'));
    await mkdir(join(directory, 'credentials'));
    const secretMarker = `credential-not-in-export-${randomUUID()}`;
    await writeFile(join(directory, 'credentials', 'openai'), secretMarker);
    const assetId = randomUUID();
    const assetBytes = Buffer.from('Fixture image asset bytes');
    await writeFile(join(directory, 'assets', assetId), assetBytes);
    active().registerAsset({
      id: assetId,
      mime: 'image/png',
      type: 'image',
      size: assetBytes.length,
      hash: createHash('sha256').update(assetBytes).digest('hex'),
    });
    const attachment: Attachment = {
      path: 'screenshot.png',
      name: 'screenshot.png',
      kind: 'image',
      mime: 'image/png',
      size: assetBytes.length,
      assetId,
      content: '',
    };
    const project = active().addProject(directory);
    active().trustProject(project.id, true);
    const original = active().createConversation(project.id);
    const session = active().session(original.id, 'openai', 'fixture-model', 'chat');
    active().nativeSession(session.id, 'original-native-session');
    const first = active().startTurn(
      original.id,
      session,
      randomUUID(),
      'Find the old lighthouse decision København',
      'Shared immutable context',
      '',
      [attachment],
    );
    active().event(
      first.turn,
      'text',
      {},
      {
        id: first.assistantId,
        itemId: 'answer',
        phase: 'answer',
        delta: 'Lighthouse decision: preserve the existing original.',
      },
    );
    active().finish(first.turn, 'completed');
    const firstUser = active().messages(original.id)[0];
    for (let n = 0; n < 70; n++) {
      const turn = active().startTurn(original.id, session, randomUUID(), `Later prompt ${n}`);
      active().event(turn.turn, 'text', {}, { id: turn.assistantId, delta: `Later answer ${n}` });
      active().finish(turn.turn, 'completed');
    }
    assert.ok(
      !active()
        .view(original.id)
        .messages.some((message) => message.id === first.assistantId),
    );
    const found = active().search('lighthouse');
    assert.ok(found.some((result) => result.messageId === first.assistantId));
    assert.ok(
      active()
        .view(original.id, undefined, first.assistantId)
        .messages.some((message) => message.id === first.assistantId),
    );
    assert.ok(
      active()
        .search('København')
        .some((result) => result.messageId === firstUser.id),
    );
    assert.deepEqual(active().search('" OR 1=1 --'), []);
    active().pin(original.id, true);
    const later = active().createConversation();
    assert.equal(active().conversations()[0].id, original.id);
    active().archive(original.id);
    assert.equal(active().search('lighthouse').length, 0);
    assert.ok(
      active()
        .search('lighthouse', { archived: true })
        .some((result) => result.conversationId === original.id),
    );
    assert.ok(
      active()
        .conversations(true)
        .some((conversation) => conversation.id === original.id),
    );
    active().restoreConversation(original.id);
    assert.equal(active().conversation(original.id).pinned, true);
    assert.equal(active().search('lighthouse', { conversationId: later.id }).length, 0);

    const branch = active().branch(original.id, first.assistantId);
    assert.equal(active().messages(branch.id).length, 2);
    assert.equal(active().messages(original.id).length, 142);
    assert.equal(active().messages(branch.id)[0].context, 'Shared immutable context');
    assert.deepEqual(active().messages(branch.id)[0].attachments, [attachment]);
    assert.equal(active().lastSession(branch.id)?.nativeId, null);
    assert.equal(branch.parentConversationId, original.id);
    assert.equal(branch.parentMessageId, first.assistantId);
    const edit = active().branch(original.id, firstUser.id, true);
    assert.equal(active().messages(edit.id).length, 0);
    assert.equal(active().draft(edit.id)?.text, firstUser.text);
    assert.deepEqual(active().draft(edit.id)?.attachments, [attachment]);
    const draft: Draft = {
      text: 'Unsent draft survives restart',
      provider: 'openai',
      model: 'fixture-model',
      mode: 'chat',
      effort: '',
      attachments: [attachment],
    };
    active().saveDraft(later.id, draft);
    active().patchSettings({ fontSize: 18 });
    active().patchSettings({ appearance: { dimming: 0.3 } });
    assert.equal(active().settings().fontSize, 18);
    assert.equal(active().settings().appearance.dimming, 0.3);
    const beforeRevision = active().configurationRevision('openai');
    active().saveConnection({ ...active().connection('openai'), enabled: false });
    assert.equal(active().configurationRevision('openai'), beforeRevision);
    active().credentialChanged('openai');
    assert.notEqual(active().configurationRevision('openai'), beforeRevision);
    active().saveConnection({
      ...active().connection('openai'),
      endpoint: 'https://example.com/v1',
    });
    assert.notEqual(active().configurationRevision('openai'), beforeRevision);
    assert.equal(active().conversation(original.id).connectionChanged, true);
    assert.notEqual(
      active().session(original.id, 'openai', 'fixture-model', 'chat').id,
      session.id,
    );
    active().close();
    store = new Store(database, migrations);
    assert.deepEqual(active().draft(later.id), draft);
    assert.deepEqual(active().messages(branch.id)[0].attachments, [attachment]);
    assert.equal(active().transcript(session.id)[0].text, firstUser.text);
    assert.equal(active().transcript(session.id)[0].context, 'Shared immutable context');
    const mixed = active().session(original.id, 'anthropic', 'fixture-model', 'chat');
    const mixedTurn = active().startTurn(original.id, mixed, randomUUID(), 'New provider prompt');
    active().finish(mixedTurn.turn, 'completed');
    assert.ok(
      active()
        .search('lighthouse', { providerId: 'openai' })
        .some((result) => result.messageId === first.assistantId),
    );

    const exported = active().exportData(branch.id);
    const assets = await embeddedAssets(directory, exported.assets);
    assert.equal(assets[0].data, assetBytes.toString('base64'));
    assert.ok(!JSON.stringify({ ...exported, assets }).includes(secretMarker));
    assert.ok(!markdownTranscript(exported.conversation, exported.messages).includes(secretMarker));
    assert.ok(
      !(await printTranscript(exported.conversation, exported.messages)).includes(secretMarker),
    );
    const imported = active().importData(exported);
    assert.deepEqual(
      active()
        .messages(imported.id)
        .map((message) => [message.role, message.text, message.context, message.attachments]),
      exported.messages.map((message) => [
        message.role,
        message.text,
        message.context,
        message.attachments,
      ]),
    );
    assert.equal(active().lastSession(imported.id)?.nativeId, null);
    const uncommittedAsset = {
      id: randomUUID(),
      mime: 'image/png',
      type: 'image',
      size: assetBytes.length,
      hash: createHash('sha256').update(assetBytes).digest('hex'),
    };
    const invalidImport = structuredClone(exported);
    invalidImport.messages[0].attachments = [{ ...attachment, assetId: randomUUID() }];
    const conversationsBeforeFailure = active()
      .db.prepare('SELECT COUNT(*) AS count FROM conversations')
      .get();
    assert.throws(
      () => active().importData(invalidImport, [uncommittedAsset]),
      /FOREIGN KEY constraint failed/,
    );
    assert.deepEqual(
      active().db.prepare('SELECT COUNT(*) AS count FROM conversations').get(),
      conversationsBeforeFailure,
    );
    assert.equal(active().asset(uncommittedAsset.id), undefined);
    assert.deepEqual(active().messages(branch.id), exported.messages);
    const partial = active().createConversation();
    const partialSession = active().session(partial.id, 'openai', 'fixture-model', 'chat');
    const failed = active().startTurn(
      partial.id,
      partialSession,
      randomUUID(),
      'Preserve a failed reply',
    );
    active().event(
      failed.turn,
      'text',
      {},
      {
        id: failed.assistantId,
        itemId: 'progress',
        phase: 'commentary',
        delta: 'Started inspecting.',
      },
    );
    active().event(
      failed.turn,
      'text',
      {},
      { id: failed.assistantId, itemId: 'answer', phase: 'answer', delta: 'Partial result.' },
    );
    active().finish(failed.turn, 'failed', 'Fixture connection lost', {
      code: 'network',
      message: 'Fixture connection lost',
      retryable: true,
      action: 'Review the partial response before retrying.',
    });
    const originalPartial = active().messages(partial.id).at(-1)!;
    const importedPartial = active().importData(active().exportData(partial.id));
    const restoredPartial = active().messages(importedPartial.id).at(-1)!;
    assert.equal(restoredPartial.status, 'failed');
    assert.deepEqual(restoredPartial.blocks, originalPartial.blocks);
    assert.deepEqual(restoredPartial.errorInfo, originalPartial.errorInfo);

    const cliConnections = active()
      .connections()
      .filter((connection) => connection.kind === 'cli-agent')
      .map((connection) => ({
        ...connection,
        executable: join(directory, `${connection.id}-saved.exe`),
        model: 'preserved-cli-model',
        enabled: true,
        configured: true,
      }));
    for (const connection of cliConnections) active().saveConnection(connection);
    const apiConnection = active().connection('openai');
    const restoredWorktree = active().addWorkspace(
      project.id,
      join(directory, 'worktree'),
      'fixture-branch',
      'HEAD',
    );
    active().archiveWorkspace(restoredWorktree.id);
    assert.ok(active().workspace(restoredWorktree.id).trusted);
    const backupPath = join(directory, 'profile.backup.gz');
    await writeBackup(host, directory, backupPath);
    const originalBackup = await readFile(backupPath);
    await writeFile(join(directory, 'assets', assetId), 'Damaged asset');
    await assert.rejects(() => writeBackup(host, directory, backupPath), /missing or damaged/);
    assert.deepEqual(await readFile(backupPath), originalBackup);
    await writeFile(join(directory, 'assets', assetId), assetBytes);
    await writeBackup(host, directory, backupPath);
    const envelope = JSON.parse((await expand(await readFile(backupPath))).toString('utf8'));
    assert.ok(!Buffer.from(envelope.database, 'base64').toString('utf8').includes(secretMarker));
    assert.ok(!JSON.stringify(envelope).includes(secretMarker));
    const prepared = await prepareRestore(host, directory, backupPath);
    const validation = validateDatabase(join(prepared, 'multiclient.sqlite'));
    assert.equal(validation.version, SUPPORTED_SCHEMA_VERSION);
    assert.equal(validation.assets.length, 1);
    const staged = new Database(join(prepared, 'multiclient.sqlite'), { readonly: true });
    try {
      for (const connection of cliConnections) {
        const row = staged
          .prepare('SELECT config FROM provider_connections WHERE id=?')
          .get(connection.id) as { config: string };
        assert.deepEqual(JSON.parse(row.config), {
          ...connection,
          enabled: false,
          executable: '',
        });
        assert.deepEqual(active().connection(connection.id), connection);
      }
      assert.equal(
        (
          staged.prepare('SELECT COUNT(*) AS count FROM workspaces WHERE trusted<>0').get() as {
            count: number;
          }
        ).count,
        0,
      );
      assert.ok(active().project(project.id).trusted);
      assert.ok(active().workspace(restoredWorktree.id).trusted);
    } finally {
      staged.close();
    }
    active().rename(branch.id, 'After backup mutation');
    await installRestore(host, directory, prepared);
    assert.equal(active().conversation(branch.id).title, branch.title);
    assert.equal(active().project(project.id).trusted, false);
    assert.equal(active().workspace(restoredWorktree.id).trusted, false);
    assert.equal(active().workspace(restoredWorktree.id).archived, true);
    for (const connection of cliConnections)
      assert.deepEqual(active().connection(connection.id), {
        ...connection,
        enabled: false,
        executable: '',
      });
    assert.deepEqual(active().connection('openai'), apiConnection);
    assert.equal(await readFile(join(directory, 'credentials', 'openai'), 'utf8'), secretMarker);
    assert.deepEqual(await readFile(join(directory, 'assets', assetId)), assetBytes);
    const corrupt = structuredClone(envelope);
    corrupt.assets[0].data = Buffer.from('corrupt asset').toString('base64');
    const corruptPath = join(directory, 'corrupt.backup.gz');
    await writeFile(corruptPath, await compress(Buffer.from(JSON.stringify(corrupt))));
    await assert.rejects(() => prepareRestore(host, directory, corruptPath), /corrupt/);
    assert.equal(active().conversation(branch.id).title, branch.title);
    const missing = structuredClone(envelope);
    missing.assets = [];
    const missingPath = join(directory, 'missing.backup.gz');
    await writeFile(missingPath, await compress(Buffer.from(JSON.stringify(missing))));
    await assert.rejects(() => prepareRestore(host, directory, missingPath), /missing assets/);
    const rollbackPrepared = await prepareRestore(host, directory, backupPath);
    active().rename(branch.id, 'Must survive failed restore');
    failNextStart = true;
    await assert.rejects(
      () => installRestore(host, directory, rollbackPrepared),
      /Simulated runtime startup failure/,
    );
    assert.equal(active().conversation(branch.id).title, 'Must survive failed restore');
    assert.deepEqual(await readFile(join(directory, 'assets', assetId)), assetBytes);

    const incompletePath = join(directory, 'incomplete.sqlite');
    const incomplete = new Store(incompletePath, migrations);
    incomplete.db.exec('DROP TABLE terminal_profiles');
    incomplete.close();
    assert.throws(
      () => validateRestoredDatabase(incompletePath, migrations),
      /missing required data/,
    );
    assert.equal(active().conversation(branch.id).title, 'Must survive failed restore');

    const stress = active().createConversation();
    const stressSession = active().session(stress.id, 'compatible', 'fixture-model', 'chat');
    const insertStarted = performance.now();
    for (let n = 0; n < 5000; n++) {
      const turn = active().startTurn(
        stress.id,
        stressSession,
        randomUUID(),
        `Benchmark prompt ${n}: persistent conversation history`,
      );
      active().event(
        turn.turn,
        'text',
        {},
        {
          id: turn.assistantId,
          delta: `Benchmark answer ${n}: inspect changes and keep the conversation durable.`,
        },
      );
      active().event(turn.turn, 'tool', {
        id: `tool-${n}`,
        title: 'Read a file',
        detail: `file-${n}.ts`,
        status: 'running',
      });
      active().event(turn.turn, 'tool', {
        id: `tool-${n}`,
        title: 'Read a file',
        detail: `file-${n}.ts`,
        status: 'completed',
      });
      active().finish(turn.turn, 'completed');
    }
    timings.insert10000MessagesAnd10000ToolEventsMs = Math.round(performance.now() - insertStarted);
    assert.equal(active().messages(stress.id).length, 10000);
    assert.equal(active().view(stress.id).messages.length, 100);
    assert.equal(active().view(stress.id).tools.length, 50);
    measure('latest100MessagesMeanMs', () => active().view(stress.id));
    measure('fullTextSearchMeanMs', () => active().search('persistent'));
    measure('fullTranscriptMeanMs', () => active().messages(stress.id), 3);
    const firstStress = active().messages(stress.id)[0];
    measure('revealFirstMessageMeanMs', () => active().view(stress.id, undefined, firstStress.id));
    const restartStarted = performance.now();
    active().close();
    store = new Store(database, migrations);
    timings.restartMs = Math.round((performance.now() - restartStarted) * 100) / 100;
    await contextAcceptance(directory, migrations);
    hydrationAcceptance(directory, migrations);
    console.log(
      'History acceptance passed: unloaded search, archived/pinned history, immutable branches, attachments, drafts, revisions, export privacy, online backup, restored CLI/trust sanitization, corruption rejection and failed-restore rollback.',
    );
    console.log(
      JSON.stringify(
        {
          platform: process.platform,
          electron: process.versions.electron,
          node: process.versions.node,
          messages: 10000,
          toolEvents: 10000,
          timings,
        },
        null,
        2,
      ),
    );
  } finally {
    store?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../src/runtime/storage/store';
import { Coordinator } from '../../src/runtime/conversations/coordinator';
const directory = mkdtempSync(join(tmpdir(), 'multiclient-storage-'));
const database = join(directory, 'test.sqlite');
async function test() {
  let store = new Store(database, resolve('migrations'));
  const project = store.addProject(directory);
  assert.equal(project.trusted, false);
  store.trustProject(project.id, true);
  const c = store.createConversation(project.id);
  const session = store.session(c.id, 'codex', '', 'ask');
  const request = randomUUID();
  const { turn, assistantId } = store.startTurn(
    c.id,
    session,
    request,
    'Hello',
    'Attached file snapshot',
    'high',
  );
  const cursor = store.event(turn, 'text', { text: 'world' }, { id: assistantId, delta: 'world' });
  assert.ok(cursor > 0);
  assert.equal(store.view(c.id).messages[1].text, 'world');
  assert.equal(store.turnByRequest(request)?.id, turn.id);
  assert.throws(() => store.startTurn(c.id, session, request, 'Duplicate'));
  const i = {
    id: randomUUID(),
    conversationId: c.id,
    sessionId: session.id,
    turnId: turn.id,
    kind: 'approval' as const,
    title: 'Allow?',
    detail: 'test',
    status: 'pending' as const,
  };
  store.interaction(i);
  store.close();
  store = new Store(database, resolve('migrations'));
  assert.equal(store.view(c.id).messages[1].status, 'interrupted');
  assert.equal(store.conversation(c.id).effort, 'high');
  assert.equal(store.view(c.id).interactions.length, 0);
  assert.equal(store.project(project.id).trusted, true);
  assert.equal(store.view(c.id).messages[0].text, 'Hello');
  assert.equal(store.transcript(session.id)[0].text, 'Hello');
  assert.equal(store.transcript(session.id)[0].context, 'Attached file snapshot');
  const structured = store.startTurn(c.id, session, randomUUID(), 'Check the folder');
  store.event(
    structured.turn,
    'text',
    {},
    { id: structured.assistantId, itemId: 'progress', phase: 'commentary', delta: 'Checking' },
  );
  store.event(
    structured.turn,
    'text',
    {},
    { id: structured.assistantId, itemId: 'answer', phase: 'answer', delta: 'Here is the answer.' },
  );
  store.event(
    structured.turn,
    'text',
    {},
    { id: structured.assistantId, itemId: 'progress', phase: 'commentary', delta: ' the folder.' },
  );
  store.finish(structured.turn, 'completed');
  store.close();
  store = new Store(database, resolve('migrations'));
  const response = store.view(c.id).messages.at(-1)!;
  assert.equal(response.text, 'Checking the folder.\n\nHere is the answer.');
  assert.deepEqual(response.blocks, [
    { id: 'progress', phase: 'commentary', text: 'Checking the folder.' },
    { id: 'answer', phase: 'answer', text: 'Here is the answer.' },
  ]);
  const c2 = store.createConversation();
  const activityChat = store.createConversation();
  const activitySession = store.session(activityChat.id, 'codex', '', 'ask');
  const activityTurns: string[] = [];
  for (const label of ['First', 'Second']) {
    const { turn } = store.startTurn(activityChat.id, activitySession, randomUUID(), label);
    activityTurns.push(turn.id);
    store.event(turn, 'tool', {
      id: 'reused-id',
      title: label,
      detail: 'Running',
      status: 'running',
    });
    store.event(turn, 'tool', {
      id: 'reused-id',
      title: label,
      detail: 'Finished',
      status: 'completed',
    });
    store.event(turn, 'warning', { message: `${label} warning` });
    store.finish(turn, 'failed', `${label} error`);
  }
  store.close();
  store = new Store(database, resolve('migrations'));
  const activities = store.view(activityChat.id).tools;
  assert.equal(activities.length, 6);
  for (const [index, label] of ['First', 'Second'].entries()) {
    const own = activities.filter((tool) => tool.turnId === activityTurns[index]);
    assert.equal(own.length, 3);
    assert.deepEqual(
      own.map((tool) => tool.detail),
      ['Finished', `${label} warning`, `${label} error`],
    );
    assert.equal(own[0].title, label);
    assert.equal(own[0].status, 'completed');
  }
  const s1 = store.session(c2.id, 'openai', 'example', 'chat');
  const s2 = store.session(c2.id, 'anthropic', 'example', 'chat');
  assert.notEqual(s1.id, s2.id);
  assert.equal(store.session(c2.id, 'anthropic', 'example', 'chat').id, s2.id);
  assert.notEqual(store.session(c2.id, 'openai', 'example', 'chat').id, s1.id);
  const permissionsChat = store.createConversation(project.id);
  const code = store.session(permissionsChat.id, 'codex', '', 'code');
  store.nativeSession(code.id, 'approved-session');
  const bypass = store.session(permissionsChat.id, 'codex', '', 'code-bypass');
  assert.notEqual(bypass.id, code.id);
  assert.equal(bypass.nativeId, null);
  store.nativeSession(bypass.id, 'bypass-session');
  assert.equal(
    store.session(permissionsChat.id, 'codex', '', 'code-bypass').nativeId,
    'bypass-session',
  );
  const bypassTurn = store.startTurn(permissionsChat.id, bypass, randomUUID(), 'Bypass request');
  store.finish(bypassTurn.turn, 'completed');
  store.close();
  store = new Store(database, resolve('migrations'));
  assert.equal(store.view(permissionsChat.id).conversation.mode, 'code-bypass');
  assert.equal(
    store.session(permissionsChat.id, 'codex', '', 'code-bypass').nativeId,
    'bypass-session',
  );
  const codeAgain = store.session(permissionsChat.id, 'codex', '', 'code');
  assert.notEqual(codeAgain.id, bypass.id);
  assert.equal(codeAgain.nativeId, null);
  for (let n = 0; n < 55; n++) {
    const started = store.startTurn(c2.id, s2, randomUUID(), `Message ${n}`);
    store.event(started.turn, 'tool', {
      id: 'reused-id',
      title: `Activity ${n}`,
      detail: '',
      status: 'completed',
    });
    store.finish(started.turn, 'completed');
  }
  const latest = store.view(c2.id);
  assert.equal(latest.messages.length, 100);
  assert.equal(latest.hasMore, true);
  const earlier = store.view(c2.id, latest.messages[0].id);
  assert.equal(earlier.messages.length, 10);
  assert.equal(earlier.hasMore, false);
  assert.equal(latest.tools.length, 50);
  assert.equal(earlier.tools.length, 5);
  assert.ok(
    earlier.tools.every((tool) =>
      earlier.messages.some((message) => message.turnId === tool.turnId),
    ),
  );
  store.removeProject(project.id);
  assert.equal(store.conversation(c.id).projectId, null);
  process.env.MULTICLIENT_TEST_MODE = '1';
  store.saveConnection({
    id: 'demo',
    name: 'Test',
    kind: 'api-chat',
    executable: '',
    endpoint: '',
    model: '',
    enabled: true,
    configured: true,
  });
  const coordinator = new Coordinator(
    store,
    directory,
    '',
    () => {},
    async () => undefined,
  );
  const chat = store.createConversation();
  const input = {
    conversationId: chat.id,
    requestId: randomUUID(),
    text: 'Hello',
    providerId: 'demo' as const,
    mode: 'chat',
    model: '',
    attachments: [],
  };
  for (const id of ['openai', 'anthropic', 'compatible'] as const) {
    // API connections retain settings and are available without installing an agent CLI.
    store.saveConnection({ ...store.connection(id), enabled: true, model: 'saved-model' });
    assert.equal(store.connection(id).enabled, true);
    const stored = store.db
      .prepare('SELECT config FROM provider_connections WHERE id=?')
      .get(id) as { config: string };
    assert.equal(JSON.parse(stored.config).enabled, true);
    assert.equal(store.connection(id).model, 'saved-model');
  }
  assert.equal(store.view(c2.id).messages.length, 100);
  assert.equal(store.view(chat.id).messages.length, 0);
  const first = await coordinator.send(input);
  const duplicate = await coordinator.send(input);
  assert.equal(first.id, duplicate.id);
  await assert.rejects(
    () => coordinator.send({ ...input, requestId: randomUUID() }),
    /active turn/,
  );
  await coordinator.close();
  assert.equal(store.view(chat.id).messages[1].status, 'cancelled');
  const personal = store.createConversation();
  store.saveConnection({
    ...store.connection('codex'),
    executable: join(directory, 'missing-codex.exe'),
  });
  await assert.rejects(
    () =>
      coordinator.send({
        ...input,
        conversationId: personal.id,
        requestId: randomUUID(),
        providerId: 'codex',
        mode: 'code',
      }),
    /Select a trusted project/,
  );
  await assert.rejects(
    () =>
      coordinator.send({
        ...input,
        conversationId: personal.id,
        requestId: randomUUID(),
        providerId: 'codex',
        mode: 'ask',
      }),
    /ENOENT|configured executable|could not be found/,
  );
  await coordinator.close();
  assert.equal(store.view(personal.id).messages.length, 0);
  store.close();
  const badMigrations = join(directory, 'migrations');
  mkdirSync(badMigrations);
  writeFileSync(
    join(badMigrations, '999_bad.sql'),
    'CREATE TABLE should_rollback(id TEXT); INVALID SQL;',
  );
  assert.throws(() => new Store(database, badMigrations));
  store = new Store(database, resolve('migrations'));
  assert.equal(
    store.db.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").get(),
    undefined,
  );
  store.close();
  console.log(
    'Storage integration passed: migrations, durability, interruption, pagination, session boundaries, deduplication, cancellation.',
  );
}
test()
  .then(() => {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      /* Windows may retain the deliberately failed migration connection until process exit. */
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

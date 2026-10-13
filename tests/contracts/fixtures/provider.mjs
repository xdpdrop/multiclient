// Synthetic protocol peer. This does not authenticate or contact any provider.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
const provider = process.argv[2];
const args = process.argv.slice(3);
const bypass =
  args.includes('approval_policy="never"') ||
  args.includes('--dangerously-skip-permissions') ||
  args.includes('--force');
const output = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const response = (id, result) => output({ jsonrpc: '2.0', id, result });
const notification = (method, params) => output({ jsonrpc: '2.0', method, params });
const request = (id, method, params) => output({ jsonrpc: '2.0', id, method, params });
process.stderr.write('Harmless stderr noise\n');
if (provider === 'claude-code') {
  assert.equal(args.includes('--restricted'), !bypass);
  assert.equal(
    args[args.indexOf('--permission-mode') + 1],
    bypass ? 'bypassPermissions' : 'manual',
  );
  assert.equal(args[args.indexOf('--model') + 1], 'opus');
  assert.equal(args[args.indexOf('--effort') + 1], 'max');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  const config = JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
  const env = config.mcpServers.multiclient.env;
  const permission = (input) =>
    new Promise((resolve, reject) => {
      const socket = connect(env.MULTICLIENT_BRIDGE_SOCKET, () =>
        socket.write(JSON.stringify({ token: env.MULTICLIENT_BRIDGE_TOKEN, input }) + '\n'),
      );
      let text = '';
      socket.on('data', (chunk) => (text += chunk));
      socket.on('end', () => resolve(JSON.parse(text)));
      socket.on('error', reject);
    });
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  assert.ok(prompt);
  const denied = await permission({ tool_name: 'Bash', tool_input: { command: 'echo forbidden' } });
  assert.equal(denied.behavior, prompt === 'code-allow' ? 'allow' : 'deny');
  if (prompt.startsWith('code-')) {
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
    if (bypass) assert.deepEqual(settings, { disableAllHooks: true });
    else assert.deepEqual(settings.permissions.ask, ['Bash', 'Edit', 'Write', 'NotebookEdit']);
    assert.ok(args[args.indexOf('--tools') + 1].includes('Write'));
    const edit = await permission({
      tool_name: 'Write',
      input: { file_path: 'target.txt', content: 'CHANGED' },
    });
    assert.equal(edit.behavior, prompt === 'code-allow' ? 'allow' : 'deny');
    if (edit.behavior === 'allow')
      assert.deepEqual(edit.updatedInput, { file_path: 'target.txt', content: 'CHANGED' });
  }
  const answer = await permission({
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'Color?', options: [{ label: 'Blue' }] }] },
  });
  assert.equal(answer.updatedInput.answers['Color?'], 'Blue');
  output({
    type: 'system',
    session_id: args.includes('--resume') ? args[args.indexOf('--resume') + 1] : 'claude-native',
  });
  output({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello 🌍' } },
  });
  output({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello 🌍' }] } });
  output({ type: 'result', is_error: false });
} else {
  const lines = createInterface({ input: process.stdin });
  let promptId;
  let phase = '';
  let allow = false;
  let code = false;
  for await (const line of lines) {
    const m = JSON.parse(line);
    if (m.method === 'initialize')
      response(m.id, { protocolVersion: 1, agentCapabilities: { loadSession: true } });
    else if (m.method === 'initialized') continue;
    else if (m.method === 'model/list')
      response(m.id, {
        data: [
          {
            id: 'fixture-model',
            model: 'fixture-model',
            displayName: 'Fixture',
            supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
          },
        ],
      });
    else if (m.method === 'account/read') response(m.id, { account: { type: 'chatgpt' } });
    else if (m.method === 'config/read')
      response(m.id, { config: { mcp_servers: { inherited: { enabled: true } } } });
    else if (m.method === 'thread/start' || m.method === 'thread/resume') {
      assert.equal(m.params.sandbox, bypass ? 'danger-full-access' : 'read-only');
      assert.equal(m.params.approvalPolicy, bypass ? 'never' : 'on-request');
      assert.equal(m.params.config.mcp_servers.inherited.enabled, false);
      const servers = Object.entries(m.params.config.mcp_servers).filter(([name]) =>
        name.startsWith('multiclient_workspace_'),
      );
      assert.equal(servers.length, 1);
      assert.equal(servers[0][1].required, true);
      assert.deepEqual(servers[0][1].enabled_tools, ['list_directory', 'read_file']);
      assert.equal(servers[0][1].args.at(-1), process.cwd());
      response(m.id, {
        thread: { id: m.params.threadId || 'codex-native' },
        sandbox: bypass ? { type: 'dangerFullAccess' } : { type: 'readOnly', networkAccess: false },
        approvalPolicy: bypass ? 'never' : 'on-request',
        approvalsReviewer: 'user',
      });
    } else if (m.method === 'turn/start' || m.method === 'review/start') {
      if (m.method === 'turn/start') {
        assert.deepEqual(
          m.params.sandboxPolicy,
          bypass ? { type: 'dangerFullAccess' } : { type: 'readOnly', networkAccess: false },
        );
        assert.equal(m.params.approvalPolicy, bypass ? 'never' : 'on-request');
        assert.equal(m.params.effort, m.params.input[0].text === 'wait' ? null : 'high');
        assert.deepEqual(m.params.input[0].text_elements, []);
      }
      const text = m.params.input?.[0].text ?? '';
      code = text.startsWith('code-');
      allow = text === 'code-allow';
      assert.equal(args.includes('features.shell_tool=true'), code);
      response(m.id, { turn: { id: 'turn-native' } });
      notification('turn/started', { threadId: 'codex-native', turn: { id: 'turn-native' } });
      if (m.params.input?.[0].text === 'wait') continue;
      request(101, 'item/commandExecution/requestApproval', {
        threadId: 'codex-native',
        turnId: 'turn-native',
        itemId: 'cmd',
        command: 'echo forbidden',
      });
      phase = 'codex-permission';
    } else if (m.id === 101 && phase === 'codex-permission') {
      assert.equal(m.result.decision, allow ? 'accept' : 'decline');
      notification('item/started', {
        threadId: 'codex-native',
        item: {
          id: 'edit',
          type: 'fileChange',
          changes: [{ path: 'target.txt', diff: '+CHANGED' }],
        },
      });
      request(103, 'item/fileChange/requestApproval', {
        threadId: 'codex-native',
        turnId: 'turn-native',
        itemId: 'edit',
      });
    } else if (m.id === 103) {
      assert.equal(m.result.decision, allow ? 'accept' : 'decline');
      request(104, 'item/fileChange/requestApproval', {
        threadId: 'wrong-thread',
        turnId: 'turn-native',
        itemId: 'edit',
      });
    } else if (m.id === 104) {
      assert.equal(m.result.decision, 'decline');
      request(105, 'item/permissions/requestApproval', {
        threadId: 'codex-native',
        turnId: 'turn-native',
        itemId: 'expand',
        permissions: { fileSystem: { write: ['/'] } },
      });
    } else if (m.id === 105) {
      assert.deepEqual(m.result, { permissions: {}, scope: 'turn' });
      request(102, 'unknown/blocking', {});
    } else if (m.id === 102) {
      assert.equal(m.error.code, -32601);
      notification('item/started', {
        threadId: 'codex-native',
        item: { id: 'progress', type: 'agentMessage', phase: 'commentary', text: '' },
      });
      notification('item/agentMessage/delta', {
        threadId: 'codex-native',
        itemId: 'progress',
        delta: 'Checking the ',
      });
      notification('item/agentMessage/delta', {
        threadId: 'codex-native',
        itemId: 'progress',
        delta: 'folder.',
      });
      notification('item/completed', {
        threadId: 'codex-native',
        item: {
          id: 'progress',
          type: 'agentMessage',
          phase: 'commentary',
          text: 'Checking the folder.',
        },
      });
      notification('item/started', {
        threadId: 'codex-native',
        item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '' },
      });
      notification('item/agentMessage/delta', {
        threadId: 'codex-native',
        itemId: 'answer',
        delta: 'Hello ',
      });
      const answer = {
        threadId: 'codex-native',
        item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Hello 🌍' },
      };
      notification('item/completed', answer);
      notification('item/completed', answer);
      notification('item/completed', {
        threadId: 'codex-native',
        item: { id: 'reasoning', type: 'reasoning', content: 'Do not display this.' },
      });
      notification('turn/completed', { threadId: 'codex-native', turn: { status: 'completed' } });
    } else if (m.method === 'turn/interrupt') {
      response(m.id, {});
      notification('turn/completed', { threadId: 'codex-native', turn: { status: 'interrupted' } });
    } else if (m.method === 'session/new' || m.method === 'session/load') {
      assert.deepEqual(m.params.mcpServers, []);
      assert.equal(args[args.indexOf('--sandbox') + 1], bypass ? 'disabled' : 'enabled');
      response(m.id, {
        sessionId: m.params.sessionId || 'cursor-native',
        modes: { availableModes: [{ id: 'ask' }, { id: 'plan' }, { id: 'agent' }] },
      });
    } else if (m.method === 'session/set_mode' || m.method === 'session/set_config_option')
      response(m.id, {});
    else if (m.method === 'session/prompt') {
      allow = m.params.prompt[0].text === 'code-allow';
      promptId = m.id;
      request(201, 'session/request_permission', {
        sessionId: 'cursor-native',
        toolCall: { title: 'Edit target.txt', rawInput: { path: 'target.txt' } },
        options: [
          { kind: 'allow_once', optionId: 'yes' },
          { kind: 'reject_once', optionId: 'no' },
        ],
      });
    } else if (m.id === 201) {
      assert.deepEqual(m.result, {
        outcome: { outcome: 'selected', optionId: allow ? 'yes' : 'no' },
      });
      request(202, 'cursor/ask_question', {
        questions: [{ id: 'color', prompt: 'Color?', options: [{ id: 'blue', label: 'Blue' }] }],
      });
    } else if (m.id === 202) {
      assert.deepEqual(m.result, {
        outcome: {
          outcome: 'answered',
          answers: [{ questionId: 'color', selectedOptionIds: ['blue'] }],
        },
      });
      notification('session/update', {
        sessionId: 'cursor-native',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello 🌍' },
        },
      });
      response(promptId, { stopReason: 'end_turn' });
    } else if (m.method === 'session/cancel') response(promptId, { stopReason: 'cancelled' });
    else throw new Error(`Unexpected fixture message ${line}`);
  }
}

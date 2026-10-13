const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const { createInterface } = require('node:readline');

async function test() {
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-bridge-'));
  const executable = process.argv[2] ? resolve(process.argv[2]) : require('electron');
  const script = process.argv[2]
    ? join(dirname(executable), 'resources', 'app.asar', 'out', 'main', 'workspace-tools.js')
    : resolve('out/main/workspace-tools.js');
  await writeFile(join(directory, 'readme.txt'), 'Read-only bridge works.');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      ['PATH', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOME', 'TEMP', 'TMP'].includes(
        name.toUpperCase(),
      ),
    ),
  );
  const child = spawn(executable, [script, directory], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    cwd: directory,
    windowsHide: true,
    stdio: 'pipe',
  });
  const pending = new Map();
  let serial = 0;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const timeout = setTimeout(() => child.kill(), 15000);
  child.stderr.resume();
  const fail = (error) => {
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('Workspace bridge exited before responding.')));
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message));
      else call?.resolve(message.result);
    } catch (error) {
      fail(error);
    }
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  try {
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    const tools = await request('tools/list');
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      ['list_directory', 'read_file'],
    );
    const list = await request('tools/call', { name: 'list_directory', arguments: { path: '.' } });
    assert.equal(JSON.parse(list.content[0].text).entries[0].name, 'readme.txt');
    const read = await request('tools/call', {
      name: 'read_file',
      arguments: { path: 'readme.txt' },
    });
    assert.equal(JSON.parse(read.content[0].text).content, 'Read-only bridge works.');
    const denied = await request('tools/call', {
      name: 'list_directory',
      arguments: { path: '..' },
    });
    assert.equal(denied.isError, true);
    console.log(
      'Workspace MCP bridge passed: Electron launch, discovery, directory listing, file reading and boundary refusal.',
    );
  } finally {
    child.stdin.end();
    await exited;
    clearTimeout(timeout);
    await rm(directory, { recursive: true, force: true });
  }
}
test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import {
  permissionBridgeEndpoint,
  preparePermissionSocketDirectory,
  sunPathLimit,
} from '../../src/runtime/providers/permission-socket';

const observedMacSocket =
  '/var/folders/36/tjdph2t965j8snz9_vkdnw0r0000gn/T/multiclient-contract-0W6yBh/bridges/2a57207f-5d7c-4836-9475-3d750f04e00b/permission.sock';
const githubMacTmp = '/var/folders/36/tjdph2t965j8snz9_vkdnw0r0000gn/T';
const sockets: string[] = [];

afterEach(async () => {
  await Promise.all(sockets.splice(0).map((socket) => rm(socket, { force: true })));
});

it('keeps a macOS permission socket inside sun_path when TMPDIR is the GitHub runner path', () => {
  expect(Buffer.byteLength(observedMacSocket)).toBeGreaterThan(sunPathLimit('darwin'));
  const socket = permissionBridgeEndpoint('darwin', githubMacTmp);
  expect(socket.startsWith(`${githubMacTmp}/mc/`)).toBe(true);
  expect(socket.endsWith('.sock')).toBe(true);
  expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(sunPathLimit('darwin'));
});

it('falls back to /tmp when the temp root cannot fit, and leaves Windows on a named pipe', () => {
  const long = `/${'p'.repeat(120)}`;
  expect(Buffer.byteLength(long)).toBeGreaterThan(104);
  const socket = permissionBridgeEndpoint('linux', long);
  expect(socket.startsWith('/tmp/mc/')).toBe(true);
  expect(socket.includes('ppp')).toBe(false);
  expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(sunPathLimit('linux'));
  expect(() => permissionBridgeEndpoint('linux', long, `/${'q'.repeat(120)}`)).toThrow(/sun_path/);
  expect(() => permissionBridgeEndpoint('darwin', long, `/${'q'.repeat(120)}`)).toThrow(/sun_path/);
  expect(permissionBridgeEndpoint('win32', long)).toMatch(/^\\\\\.\\pipe\\multiclient-/);
});

it('listens on the short permission socket', async () => {
  if (process.platform === 'win32') return;
  const root = await mkdtemp(join(tmpdir(), 'multiclient-sock-'));
  await mkdir(join(root, 'mc'), { mode: 0o700 });
  const socket = permissionBridgeEndpoint(process.platform, root);
  sockets.push(socket);
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, () => resolve());
    });
    await chmod(socket, 0o600);
    expect((await stat(socket)).isSocket()).toBe(true);
    expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(sunPathLimit());
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('reproduces the overlong-socket failure, then binds when TMPDIR itself exceeds sun_path', async () => {
  if (process.platform === 'win32') return;
  const parent = join('/tmp', `mc-long-${'d'.repeat(110)}`);
  await mkdir(parent, { recursive: true });
  const moduleUrl = pathToFileURL(resolve('src/runtime/providers/permission-socket.ts')).href;
  const script = `
    import { createServer } from 'node:net';
    import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { randomUUID } from 'node:crypto';
    import { permissionBridgeEndpoint, preparePermissionSocketDirectory, sunPathLimit } from ${JSON.stringify(moduleUrl)};
    const root = tmpdir();
    if (Buffer.byteLength(root) <= 104) throw new Error('TMPDIR is not long enough: ' + Buffer.byteLength(root));
    const data = await mkdtemp(join(root, 'multiclient-contract-'));
    const id = randomUUID();
    const legacy = join(data, 'bridges', id, 'permission.sock');
    await mkdir(join(data, 'bridges', id), { recursive: true });
    const legacyServer = createServer();
    let legacyCode = 'ok';
    try {
      await new Promise((resolve, reject) => {
        legacyServer.once('error', reject);
        legacyServer.listen(legacy, resolve);
      });
      await chmod(legacy, 0o600);
    } catch (error) {
      legacyCode = error.code || 'error';
    } finally {
      legacyServer.close();
    }
    if (legacyCode === 'ok') throw new Error('legacy socket unexpectedly bound at ' + legacy);
    const socket = permissionBridgeEndpoint();
    if (socket.startsWith(root)) throw new Error('socket stayed under long TMPDIR ' + socket);
    if (Buffer.byteLength(socket) > sunPathLimit()) throw new Error('socket exceeds sun_path');
    await preparePermissionSocketDirectory(socket);
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socket, resolve);
      });
      await chmod(socket, 0o600);
      if (!(await stat(socket)).isSocket()) throw new Error('short socket missing');
    } finally {
      server.close();
      await rm(socket, { force: true });
      await rm(data, { recursive: true, force: true });
    }
    console.log(JSON.stringify({ legacyCode, bytes: Buffer.byteLength(socket), tmp: Buffer.byteLength(root) }));
  `;
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', script],
      { env: { ...process.env, TMPDIR: parent }, timeout: 15000 },
    );
    const result = JSON.parse(stdout);
    expect(result.tmp).toBeGreaterThan(104);
    expect(['EINVAL', 'ENOENT']).toContain(result.legacyCode);
    expect(result.bytes).toBeLessThanOrEqual(sunPathLimit());
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}, 20000);

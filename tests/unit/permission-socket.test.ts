import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { permissionBridgeEndpoint, sunPathLimit } from '../../src/runtime/providers/claude-code';

const observedMacSocket =
  '/var/folders/36/tjdph2t965j8snz9_vkdnw0r0000gn/T/multiclient-contract-SNTwz2/bridges/2311dbba-4d3b-4734-b1d6-cd24ddca3c4f/permission.sock';
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

it('refuses a Unix socket path that still cannot fit, and leaves Windows on a named pipe', () => {
  expect(() => permissionBridgeEndpoint('darwin', `/${'p'.repeat(120)}`)).toThrow(/sun_path/);
  expect(() => permissionBridgeEndpoint('linux', `/${'p'.repeat(120)}`)).toThrow(/sun_path/);
  expect(permissionBridgeEndpoint('win32', `/${'p'.repeat(120)}`)).toMatch(
    /^\\\\\.\\pipe\\multiclient-/,
  );
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
    expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(sunPathLimit());
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

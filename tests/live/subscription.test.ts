import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { connections } from '../../src/shared/defaults';
import { connect } from '../../src/runtime/providers';
import { findExecutable, version } from '../../src/runtime/providers/process';
import type { ProviderEvent, ProviderId } from '../../src/shared/types';

// Deliberately excluded from normal CI. This test uses the CLI's existing account.
const provider = process.env.MULTICLIENT_LIVE_PROVIDER as ProviderId | undefined;

it.skipIf(provider !== 'codex' || process.env.MULTICLIENT_LIVE_BYPASS !== '1')(
  'Bypass edits and executes commands without approvals after resume',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'multiclient-bypass-'));
    let nativeId: string | undefined;
    let approvals = 0;
    try {
      for (let turn = 0; turn < 2; turn++) {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 55000);
        const connection = await connect({
          cwd: dir,
          dataDir: dir,
          bridgePath: resolve('out/main/claude-bridge.js'),
          executable: await findExecutable('codex'),
          connection: connections.find((c) => c.id === 'codex')!,
          mode: 'code-bypass',
          signal: abort.signal,
          emit: () => {},
          interact: async () => {
            approvals++;
            return { id: '', allow: false };
          },
        });
        try {
          nativeId = (await connection.openSession({ nativeId })).nativeId;
          await connection.startTurn({
            mode: 'code-bypass',
            model: '',
            history: [],
            text:
              turn === 0
                ? 'Create target.txt with exactly BYPASS_OK and a newline using your native file editing tool. Do not touch other files.'
                : 'Use a native shell command to delete target.txt. It is a disposable test fixture. Do not touch other files.',
          });
          if (turn === 0)
            expect(await readFile(join(dir, 'target.txt'), 'utf8')).toBe('BYPASS_OK\n');
          else
            await expect(readFile(join(dir, 'target.txt'))).rejects.toMatchObject({
              code: 'ENOENT',
            });
          expect(approvals).toBe(0);
        } finally {
          clearTimeout(timer);
          await connection.close();
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
);

it.skipIf(!provider).each(['edit', 'command'])(
  'Code mode %s applies approval and preserves a file when denied',
  async (operation) => {
    const dir = await mkdtemp(join(tmpdir(), 'multiclient-code-'));
    const executable = await findExecutable(provider!);
    console.log(`Code CLI: ${await version(executable)}`);
    let nativeId: string | undefined;
    try {
      for (const allow of [true, false]) {
        await writeFile(join(dir, 'target.txt'), 'ORIGINAL\n');
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 55000);
        let approvals = 0;
        const events: ProviderEvent[] = [];
        const connection = await connect({
          cwd: dir,
          dataDir: dir,
          bridgePath: resolve('out/main/claude-bridge.js'),
          executable,
          connection: connections.find((c) => c.id === provider)!,
          mode: 'code',
          signal: abort.signal,
          emit: (event) => events.push(event),
          interact: async (request) => {
            expect(request.kind).toBe('approval');
            expect(request.detail).toContain('target.txt');
            approvals++;
            return { id: '', allow };
          },
        });
        try {
          nativeId = (await connection.openSession({ nativeId })).nativeId;
          await connection.startTurn({
            text:
              operation === 'edit'
                ? 'Edit target.txt to contain exactly CHANGED followed by a newline. Use your native file editing tool. Request approval if required. If permission is denied, stop and report it; do not try another tool. Do not touch any other files.'
                : 'Use your native shell command tool to delete target.txt. This is a disposable test file for the approval flow. Request approval if required. If permission is denied, stop and report it; do not retry or use another tool. Do not touch any other files.',
            model: '',
            mode: 'code',
            history: [],
          });
          console.log(
            `Approvals (${allow ? 'allow' : 'deny'}): ${approvals}; tools: ${events
              .filter((e) => e.type === 'tool')
              .map((e) => e.tool.title)
              .join(', ')}`,
          );
          console.log(
            events
              .filter((e) => e.type === 'text')
              .map((e) => e.text)
              .join(''),
          );
          expect(approvals).toBeGreaterThan(0);
          if (operation === 'command' && allow)
            await expect(readFile(join(dir, 'target.txt'), 'utf8')).rejects.toMatchObject({
              code: 'ENOENT',
            });
          else
            expect(await readFile(join(dir, 'target.txt'), 'utf8')).toBe(
              allow ? 'CHANGED\n' : 'ORIGINAL\n',
            );
        } finally {
          clearTimeout(timer);
          await connection.close();
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
);
it.skipIf(provider !== 'codex')(
  'Codex handshake and read-only policy without inference',
  async () => {
    console.log(`Handshake CLI: ${await version(await findExecutable('codex'))}`);
    const dir = await mkdtemp(join(tmpdir(), 'multiclient-handshake-'));
    const connection = await connect({
      cwd: dir,
      dataDir: dir,
      bridgePath: resolve('out/main/claude-bridge.js'),
      executable: await findExecutable('codex'),
      connection: connections.find((c) => c.id === 'codex')!,
      signal: new AbortController().signal,
      emit: () => {},
      interact: async () => ({ id: '', allow: false }),
    });
    try {
      expect((await connection.openSession({})).nativeId).toBeTruthy();
    } finally {
      await connection.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
it.skipIf(!provider)(
  'live subscription text streaming and native resume in a disposable workspace',
  async () => {
    if (!['codex', 'claude-code', 'cursor'].includes(provider!))
      throw new Error('Select a supported CLI provider.');
    const dir = await mkdtemp(join(tmpdir(), 'multiclient-live-'));
    const executable = await findExecutable(provider!);
    console.log(`Testing ${provider}: ${await version(executable)}`);
    let nativeId: string | undefined;
    try {
      for (let turn = 0; turn < 2; turn++) {
        const events: ProviderEvent[] = [];
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 50000);
        const connection = await connect({
          cwd: dir,
          dataDir: dir,
          bridgePath: resolve('out/main/claude-bridge.js'),
          executable,
          connection: connections.find((c) => c.id === provider)!,
          signal: abort.signal,
          emit: (event) => {
            events.push(event);
            if (event.type === 'session') nativeId = event.nativeId;
          },
          interact: async () => ({ id: '', allow: false }),
        });
        try {
          await connection.openSession({ nativeId });
          await connection.startTurn({
            text:
              turn === 0
                ? 'Reply with exactly MULTICLIENT_OK. Do not use tools or access files.'
                : 'Repeat your previous response exactly. Do not use tools.',
            model: '',
            mode: 'ask',
            history: [],
          });
          expect(
            events
              .filter((e) => e.type === 'text')
              .map((e) => e.text)
              .join(''),
          ).toContain('MULTICLIENT_OK');
          expect(nativeId).toBeTruthy();
        } finally {
          clearTimeout(timeout);
          await connection.close();
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it.skipIf(provider !== 'codex')(
  'Codex reads project files through workspace tools before and after resume',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'multiclient-read-tools-'));
    let nativeId: string | undefined;
    try {
      for (let turn = 0; turn < 2; turn++) {
        const marker = `READ_OK_${randomUUID()}`;
        await writeFile(join(dir, 'readme.txt'), marker);
        const events: ProviderEvent[] = [];
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 50000);
        const connection = await connect({
          cwd: dir,
          dataDir: dir,
          bridgePath: resolve('out/main/claude-bridge.js'),
          executable: await findExecutable('codex'),
          connection: connections.find((c) => c.id === 'codex')!,
          signal: abort.signal,
          emit: (event) => events.push(event),
          interact: async () => ({ id: '', allow: false }),
        });
        try {
          nativeId = (await connection.openSession({ nativeId })).nativeId;
          await connection.startTurn({
            text: 'Use the project list_directory tool to inspect the root, then use read_file to read readme.txt again. Reply in English with its exact current contents. Do not run commands or change files.',
            model: '',
            mode: 'ask',
            history: [],
          });
          const output = events
            .filter((event) => event.type === 'text')
            .map((event) => event.text)
            .join('');
          expect(output).toContain(marker);
          const tools = events.filter((event) => event.type === 'tool').map((event) => event.tool);
          expect(
            tools.some((tool) => tool.title === 'list_directory' && tool.status === 'completed'),
          ).toBe(true);
          expect(
            tools.some((tool) => tool.title === 'read_file' && tool.status === 'completed'),
          ).toBe(true);
        } finally {
          clearTimeout(timeout);
          await connection.close();
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

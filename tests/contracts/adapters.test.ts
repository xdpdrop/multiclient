import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexConnection } from '../../src/runtime/providers/codex';
import { ClaudeConnection } from '../../src/runtime/providers/claude-code';
import { CursorConnection } from '../../src/runtime/providers/cursor';
import { connections } from '../../src/shared/defaults';
import type { AdapterContext } from '../../src/runtime/providers/contracts';
import type { ProviderEvent, ProviderId } from '../../src/shared/types';

vi.mock('../../src/runtime/providers/process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/runtime/providers/process')>();
  const { fileURLToPath } = await import('node:url');
  const fixture = fileURLToPath(new URL('./fixtures/provider.mjs', import.meta.url));
  return {
    ...actual,
    launch: (executable: string, args: string[], cwd: string) =>
      actual.launch(process.execPath, [fixture, executable, ...args], cwd),
  };
});

describe('official protocol adapter boundaries (synthetic peers)', () => {
  for (const provider of ['codex', 'claude-code', 'cursor'] as const) {
    it(`${provider}: streaming, resume identifiers, access refusal and blocking requests`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'multiclient-contract-'));
      const events: ProviderEvent[] = [];
      const context: AdapterContext = {
        cwd: dir,
        dataDir: dir,
        bridgePath: '',
        executable: provider,
        connection: connections.find((c) => c.id === provider)!,
        signal: new AbortController().signal,
        emit: (event) => events.push(event),
        interact: async (request) => ({
          id: 'fixture',
          allow: true,
          answers: Object.fromEntries((request.questions ?? []).map((q) => [q.id, 'Blue'])),
        }),
      };
      const connection =
        provider === 'codex'
          ? new CodexConnection(context)
          : provider === 'cursor'
            ? new CursorConnection(context)
            : new ClaudeConnection(context);
      try {
        if (connection instanceof CodexConnection) await connection.initialize();
        await connection.openSession({
          nativeId: `${provider === 'claude-code' ? 'claude' : provider}-native`,
        });
        if (provider !== 'cursor')
          await expect(
            connection.startTurn({
              text: 'Invalid depth must not execute',
              model: provider === 'claude-code' ? 'haiku' : 'fixture-model',
              effort: 'unsupported',
              mode: 'ask',
              history: [],
            }),
          ).rejects.toThrow(/does not advertise/);
        await connection.startTurn({
          text: 'Hello',
          model: provider === 'claude-code' ? 'opus' : provider === 'codex' ? 'fixture-model' : '',
          effort: provider === 'claude-code' ? 'max' : provider === 'codex' ? 'high' : undefined,
          mode: 'ask',
          history: [],
        });
        expect(
          events
            .filter((e) => e.type === 'text')
            .map((e) => e.text)
            .join(''),
        ).toBe(provider === 'codex' ? 'Checking the folder.Hello 🌍' : 'Hello 🌍');
        if (provider === 'codex') {
          const text = events.filter((event) => event.type === 'text');
          expect(text.map((event) => event.itemId)).toEqual([
            'progress',
            'progress',
            'answer',
            'answer',
          ]);
          expect(text.map((event) => event.phase)).toEqual([
            'commentary',
            'commentary',
            'answer',
            'answer',
          ]);
        }
        expect(events.some((e) => e.type === 'session')).toBe(true);
      } finally {
        await connection.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
  for (const provider of ['codex', 'claude-code', 'cursor'] as const) {
    for (const decision of ['allow', 'deny', 'bypass'] as const) {
      const allow = decision === 'allow';
      const mode = decision === 'bypass' ? 'code-bypass' : 'code';
      it(`${provider}: Code permission policy (${decision})`, async () => {
        const dir = await mkdtemp(join(tmpdir(), 'multiclient-code-contract-'));
        const requests: string[] = [];
        const context: AdapterContext = {
          cwd: dir,
          dataDir: dir,
          bridgePath: '',
          executable: provider,
          connection: connections.find((c) => c.id === provider)!,
          mode,
          signal: new AbortController().signal,
          emit: () => {},
          interact: async (request) => {
            if (request.kind === 'approval') {
              expect(request.detail).toContain(dir);
              requests.push(request.detail);
            }
            return {
              id: '',
              allow: request.kind === 'approval' ? allow : true,
              answers: Object.fromEntries((request.questions ?? []).map((q) => [q.id, 'Blue'])),
            };
          },
        };
        const connection =
          provider === 'codex'
            ? new CodexConnection(context)
            : provider === 'cursor'
              ? new CursorConnection(context)
              : new ClaudeConnection(context);
        try {
          if (connection instanceof CodexConnection) await connection.initialize();
          await connection.openSession({
            nativeId: `${provider === 'claude-code' ? 'claude' : provider}-native`,
          });
          await expect(
            connection.startTurn({
              text: 'wrong mode',
              mode: mode === 'code-bypass' ? 'ask' : 'code-bypass',
              model: '',
              history: [],
            }),
          ).rejects.toThrow('changing Code permission modes');
          await connection.startTurn({
            text: `code-${decision}`,
            mode,
            history: [],
            model:
              provider === 'claude-code' ? 'opus' : provider === 'codex' ? 'fixture-model' : '',
            effort: provider === 'claude-code' ? 'max' : provider === 'codex' ? 'high' : undefined,
          });
          expect(requests.length).toBe(decision === 'bypass' ? 0 : provider === 'cursor' ? 1 : 2);
          if (decision !== 'bypass')
            expect(requests.some((detail) => detail.includes('target.txt'))).toBe(true);
        } finally {
          await connection.close();
          await rm(dir, { recursive: true, force: true, maxRetries: 5 });
        }
      });
    }
  }
  it('Codex interrupts through the protocol and rejects the unfinished turn', async () => {
    const context: AdapterContext = {
      cwd: process.cwd(),
      dataDir: '',
      bridgePath: '',
      executable: 'codex',
      connection: connections.find((c) => c.id === 'codex')!,
      signal: new AbortController().signal,
      emit: () => {},
      interact: async () => ({ id: '', allow: false }),
    };
    const connection = new CodexConnection(context);
    try {
      await connection.initialize();
      await connection.openSession({});
      const turn = connection.startTurn({ text: 'wait', model: '', mode: 'ask', history: [] });
      const result = expect(turn).rejects.toThrow(/interrupted/);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await connection.cancelTurn();
      await result;
    } finally {
      await connection.close();
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import { Coordinator } from '../../src/runtime/conversations/coordinator';
import type { Store } from '../../src/runtime/storage/store';
import { emptyContextDb } from './fixtures/coordinator-db';

vi.mock('../../src/runtime/providers/process', () => ({
  findExecutable: async () => {
    throw new Error('Fixture reached executable lookup');
  },
  version: async () => '0.158.0',
}));
vi.mock('../../src/runtime/providers', () => ({ connect: vi.fn() }));
function setup(nativeId: string | null) {
  const store = {
    db: emptyContextDb(),
    turnByRequest: () => undefined,
    conversation: () => ({
      id: 'chat',
      archived: false,
      projectId: 'project',
      workspaceId: 'workspace',
    }),
    connection: () => ({
      id: 'codex',
      enabled: true,
      kind: 'cli-agent',
      model: '',
      executable: '',
    }),
    project: () => ({ id: 'project', path: '/', trusted: true }),
    workspace: () => ({
      id: 'workspace',
      projectId: 'project',
      path: '/',
      trusted: true,
      archived: false,
    }),
    configurationRevision: () => 'revision',
    lastSession: () => ({
      id: 'session',
      providerId: 'codex',
      model: '',
      mode: 'ask',
      nativeId,
      configurationRevision: 'revision',
    }),
    messages: () => [{ role: 'user', text: 'Copied prior context' }],
    transcript: () => [{ role: 'user', text: 'Copied prior context' }],
    startTurn: vi.fn(),
  };
  return {
    store,
    coordinator: new Coordinator(
      store as unknown as Store,
      '',
      '',
      () => {},
      async () => undefined,
    ),
  };
}
const input = {
  conversationId: 'chat',
  requestId: 'request',
  providerId: 'codex' as const,
  text: 'Continue',
  model: '',
  mode: 'ask',
  attachments: [],
};
describe('fresh CLI sessions with copied history', () => {
  it('requires explicit handoff before dispatching branched/imported native history', async () => {
    const { store, coordinator } = setup(null);
    await expect(coordinator.send(input)).rejects.toThrow(
      /fresh native session with saved history/,
    );
    expect(store.startTurn).not.toHaveBeenCalled();
    await expect(coordinator.send({ ...input, handoff: 'Copied prior context' })).rejects.toThrow(
      /reached executable lookup/,
    );
  });
  it('does not prompt again when the native session itself can resume', async () => {
    const { coordinator } = setup('native-session');
    await expect(coordinator.send(input)).rejects.toThrow(/reached executable lookup/);
  });
  it('refuses native image input instead of silently dropping its asset', async () => {
    const { store, coordinator } = setup('native-session');
    await expect(
      coordinator.send({
        ...input,
        attachments: [{ path: 'diagram.png', content: '', kind: 'image', assetId: 'image-asset' }],
      }),
    ).rejects.toThrow(/Native image attachments are not supported/);
    expect(store.startTurn).not.toHaveBeenCalled();
  });
  it('refuses scanned PDF input without extracted text before dispatch', async () => {
    const { store, coordinator } = setup('native-session');
    await expect(
      coordinator.send({ ...input, attachments: [{ path: 'scan.pdf', content: '', kind: 'pdf' }] }),
    ).rejects.toThrow(/PDF has no extracted text/);
    expect(store.startTurn).not.toHaveBeenCalled();
    await expect(
      coordinator.send({
        ...input,
        attachments: [{ path: 'text.pdf', content: 'Extracted page', kind: 'pdf' }],
      }),
    ).rejects.toThrow(/reached executable lookup/);
  });
  it('requires a fresh explicit handoff rather than pretending to filter native CLI history', async () => {
    const { store, coordinator } = setup('native-session');
    await expect(coordinator.send({ ...input, historyMessageIds: [] })).rejects.toThrow(
      /fresh conversation with an explicit context handoff/,
    );
    expect(store.startTurn).not.toHaveBeenCalled();
  });
});

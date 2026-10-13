import { it, expect, vi } from 'vitest';
import type { DesktopApi } from '../../src/shared/types';
import { contextRoutes } from '../../src/shared/context';

const bridge = vi.hoisted(() => ({ api: undefined as DesktopApi | undefined, invoke: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: DesktopApi) => {
      bridge.api = api;
    },
  },
  ipcRenderer: { invoke: bridge.invoke },
}));

it('serializes the actual preload context methods into the runtime route contracts', async () => {
  bridge.invoke.mockImplementation((channel: string, input: unknown) => {
    const route = channel.slice('multiclient:'.length) as keyof typeof contextRoutes;
    return Promise.resolve(contextRoutes[route].parse(input));
  });
  await import('../../src/preload/index');
  const api = bridge.api!;
  const id = '12345678-1234-4234-8234-123456789012';
  await api.createChatProject('Daily research');
  await api.renameProject(id, 'Updated title');
  await api.contextItems(id, 'instructions');
  await api.contextItem(id);
  await api.saveContextItem({
    projectId: id,
    kind: 'note',
    title: 'Context',
    text: 'Captured notes',
  });
  await api.removeContextItem(id, 1);
  await api.contextSnapshot(id);
  await api.contextSnapshots([id]);
  await api.snapshotContextItems([id]);
  await api.projectContextDefaults(id);
  await api.conversationContextSources(id);
  expect(bridge.invoke).toHaveBeenLastCalledWith('multiclient:conversationContextSources', { id });
});

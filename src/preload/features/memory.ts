import type { MemoryApi } from '../../shared/memory';

export function memoryApi(invoke: (route: string, input?: unknown) => Promise<any>): MemoryApi {
  return {
    memoryList: (projectId) => invoke('memoryList', { projectId }),
    memorySave: (input) => invoke('memorySave', input),
    memoryDelete: (id, expectedRevision) => invoke('memoryDelete', { id, expectedRevision }),
    memoryInclude: (id, expectedRevision, projectId) =>
      invoke('memoryInclude', { id, expectedRevision, projectId }),
    memoryDefaults: (projectId) => invoke('memoryDefaults', { projectId }),
  };
}

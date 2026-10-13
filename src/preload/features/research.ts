import type { ResearchApi } from '../../shared/research';

export function createResearchApi(
  invoke: (route: string, input?: unknown) => Promise<any>,
): ResearchApi {
  return {
    webCredentialStatus: () => invoke('webCredentialStatus'),
    webSaveCredential: (key, persist) => invoke('webSaveCredential', { key, persist }),
    webSearch: (query) => invoke('webSearch', { query }),
    webFetch: (input) => invoke('webFetch', input),
    webResearchJob: (id, draftKey) => invoke('webResearchJob', { id, draftKey }),
    webCancel: (id, draftKey) => invoke('webCancel', { id, draftKey }),
    webSource: (id) => invoke('webSource', { id }),
  };
}

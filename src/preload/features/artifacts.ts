import type { ArtifactsApi } from '../../shared/artifacts';
export function artifactsApi(
  invoke: (route: string, input?: unknown) => Promise<any>,
): ArtifactsApi {
  return {
    artifactsList: (projectId) => invoke('artifactsList', { projectId }),
    artifactRead: (id) => invoke('artifactRead', { id }),
    artifactCreate: (input) => invoke('artifactCreate', input),
    artifactSaveDraft: (input) => invoke('artifactSaveDraft', input),
    artifactCommit: (input) => invoke('artifactCommit', input),
    artifactRestore: (input) => invoke('artifactRestore', input),
    artifactFork: (input) => invoke('artifactFork', input),
    artifactLink: (input) => invoke('artifactLink', input),
    artifactPreview: (input) => invoke('artifactPreview', input),
    artifactExport: (input) => invoke('artifactExport', input),
    artifactImport: () => invoke('artifactImport'),
  };
}

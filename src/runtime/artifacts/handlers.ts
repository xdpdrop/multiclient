import { artifactRoutes, type ArtifactRoute } from '../../shared/artifacts';
import { ArtifactsStore, linkArtifactRevision, importArtifactBundle } from './store';
import type { Store } from '../storage/store';
export function handleArtifactRoute(store: Store, route: ArtifactRoute, raw: unknown): unknown {
  const input: any = artifactRoutes[route].parse(raw);
  const artifacts = new ArtifactsStore(store.db);
  switch (route) {
    case 'artifactsList':
      return artifacts.list(input.projectId);
    case 'artifactRead':
      return artifacts.view(input.id);
    case 'artifactCreate':
      return artifacts.create(input);
    case 'artifactSaveDraft':
      return artifacts.saveDraft(input);
    case 'artifactCommit':
      return artifacts.commit(input);
    case 'artifactRestore':
      return artifacts.restore(input);
    case 'artifactFork':
      return artifacts.fork(input);
    case 'artifactLink':
      return linkArtifactRevision(store.db, input);
    case 'artifactImportData':
      return importArtifactBundle(store.db, input.data, input.assets);
    default:
      throw new Error('Artifact preview and export are handled by the desktop host.');
  }
}

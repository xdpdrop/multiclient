import { it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), ipcMain: {}, dialog: {} }));
import {
  artifactDocument,
  STATIC_ARTIFACT_CSP,
  validateDiagramSource,
  cleanupUncommittedArtifactFiles,
} from '../../src/main/artifacts';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  artifactTabForKey,
  ArtifactEditorTabs,
  revisionAfterKey,
} from '../../src/renderer/features/Artifacts';
import {
  artifactSource,
  validateExportedArtifacts,
  remapArtifactAssets,
  type Artifact,
  type ArtifactRevision,
} from '../../src/shared/artifacts';
const artifact: Artifact = {
  id: randomUUID(),
  projectId: null,
  title: 'Preview',
  kind: 'markdown',
  language: '',
  headRevisionId: randomUUID(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  originConversationId: null,
  originMessageId: null,
  forkedFromRevisionId: null,
};
const revision: ArtifactRevision = {
  id: artifact.headRevisionId,
  artifactId: artifact.id,
  number: 1,
  parentRevisionId: null,
  source: '',
  author: 'user',
  sourceMessageId: null,
  createdAt: new Date().toISOString(),
  assetIds: [],
};
it('preserves imported asset files after uncertain runtime outcomes unless registration is confirmed absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'artifact-import-cleanup-'));
  const path = join(directory, 'asset');
  const written = [{ id: randomUUID(), path }];
  try {
    await writeFile(path, 'committed');
    await cleanupUncommittedArtifactFiles(
      {
        request: async () => {
          throw new Error('Runtime not ready');
        },
      },
      written,
      true,
    );
    expect(await readFile(path, 'utf8')).toBe('committed');
    await cleanupUncommittedArtifactFiles(
      { request: async () => ({ id: written[0].id }) },
      written,
      true,
    );
    expect(await readFile(path, 'utf8')).toBe('committed');
    await cleanupUncommittedArtifactFiles({ request: async () => undefined }, written, true);
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it('counts UTF8 bytes and rejects diagram configuration overrides', () => {
  expect(artifactSource.safeParse('🌍'.repeat(25000)).success).toBe(true);
  expect(artifactSource.safeParse('🌍'.repeat(25001)).success).toBe(false);
  expect(() =>
    validateDiagramSource('%%{init: {"securityLevel":"loose"}}%%\ngraph TD\nA-->B'),
  ).toThrow(/overrides/);
  expect(() => validateDiagramSource('---\nconfig:\n securityLevel: loose\n---\ngraph TD')).toThrow(
    /overrides/,
  );
  expect(() => validateDiagramSource('graph TD\nA-->B')).not.toThrow();
});
it('provides labelled manual-activation Source and Preview tabs with arrow/Home/End navigation', () => {
  expect(artifactTabForKey('source', 'ArrowRight')).toBe('preview');
  expect(artifactTabForKey('preview', 'ArrowLeft')).toBe('source');
  expect(artifactTabForKey('source', 'End')).toBe('preview');
  expect(artifactTabForKey('preview', 'Home')).toBe('source');
  expect(artifactTabForKey('source', 'Enter')).toBeUndefined();
  const revisions = [{ id: 'newer' }, { id: 'older' }];
  expect(revisionAfterKey(revisions, 'newer', 'ArrowDown')).toBe('older');
  expect(revisionAfterKey(revisions, 'older', 'ArrowUp')).toBe('newer');
  expect(revisionAfterKey(revisions, 'older', 'ArrowDown')).toBeUndefined();
  expect(revisionAfterKey(revisions, 'newer', 'Enter')).toBeUndefined();
  const html = renderToStaticMarkup(
    createElement(ArtifactEditorTabs, { tab: 'source', id: 'editor', onChange: () => {} }),
  );
  expect(html).toContain('role="tablist" aria-label="Artifact editor views"');
  expect(html).toContain('aria-controls="editor-source-panel" aria-selected="true" tabindex="0"');
  expect(html).toContain(
    'aria-controls="editor-preview-panel" aria-selected="false" tabindex="-1"',
  );
});
it('escapes code, sanitizes Markdown and never allows remote Markdown images or links', async () => {
  const code = await artifactDocument(
    { ...artifact, kind: 'code' },
    { ...revision, source: '<script>SECRET()</script>' },
    new Map(),
  );
  expect(code).toContain('&lt;script&gt;SECRET()&lt;/script&gt;');
  expect(code).toContain(STATIC_ARTIFACT_CSP);
  const markdown = await artifactDocument(
    artifact,
    {
      ...revision,
      source:
        '<script>BAD()</script>\n\n![remote](https://example.com/private.png)\n\n[link](file:///secret)',
    },
    new Map(),
  );
  expect(markdown).not.toContain('BAD()');
  expect(markdown).not.toContain('https://example.com');
  expect(markdown).not.toContain('file:///secret');
  expect(markdown).toContain('[Image: remote]');
});
it('validates complete revision/reference graphs before remapping imported assets', () => {
  const asset = randomUUID(),
    replacement = randomUUID(),
    message = randomUUID();
  const portable = {
    id: artifact.id,
    title: 'Fixture',
    kind: 'html' as const,
    language: '',
    headRevisionId: revision.id,
    revisions: [
      {
        id: revision.id,
        number: 1,
        parentRevisionId: null,
        source: `<img src="media://assets/${asset}">`,
        author: 'user' as const,
        createdAt: revision.createdAt,
        assetIds: [asset],
      },
    ],
    references: [{ messageId: message, revisionId: revision.id, relation: 'context' as const }],
  };
  expect(validateExportedArtifacts([portable], new Set([message]), new Set([asset]))).toHaveLength(
    1,
  );
  const remapped = remapArtifactAssets([portable], new Map([[asset, replacement]]));
  expect(remapped[0].revisions[0].source).toContain(replacement);
  expect(() => validateExportedArtifacts([portable], new Set(), new Set([asset]))).toThrow(
    /reference/,
  );
  expect(() => validateExportedArtifacts([portable], new Set([message]), new Set())).toThrow(
    /image/,
  );
  expect(() =>
    validateExportedArtifacts(
      [{ ...portable, revisions: [{ ...portable.revisions[0], parentRevisionId: revision.id }] }],
      new Set([message]),
      new Set([asset]),
    ),
  ).toThrow(/history/);
});

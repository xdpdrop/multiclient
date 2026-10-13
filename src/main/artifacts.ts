import { BrowserWindow, ipcMain, dialog, type IpcMainInvokeEvent } from 'electron';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, stat, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  artifactRoutes,
  artifactBundleSchema,
  validateExportedArtifacts,
  remapArtifactAssets,
  type Artifact,
  type ArtifactRevision,
  type ArtifactView,
} from '../shared/artifacts';
import { z } from 'zod';

export const STATIC_ARTIFACT_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export async function cleanupUncommittedArtifactFiles(
  runtime: { request(route: string, input: unknown): Promise<any> },
  written: { id: string; path: string }[],
  importAttempted: boolean,
) {
  await Promise.all(
    written.map(async ({ id, path }) => {
      if (importAttempted) {
        try {
          if (await runtime.request('asset', { id })) return;
        } catch {
          return;
        }
      }
      await rm(path, { force: true });
    }),
  );
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function validateDiagramSource(source: string) {
  if (Buffer.byteLength(source, 'utf8') > 100000) throw new Error('Diagram source exceeds 100 KB.');
  if (/%%\s*\{|^\s*---/m.test(source))
    throw new Error('Diagram configuration overrides are disabled in safe previews.');
}
export async function artifactDocument(
  artifact: Artifact,
  revision: ArtifactRevision,
  images: Map<string, string>,
  diagramSvg?: string,
) {
  const source = revision.source.replace(
    /media:\/\/assets\/([0-9a-f-]{36})/gi,
    (_match, id: string) => images.get(id.toLowerCase()) ?? 'about:blank',
  );
  let content: string;
  if (artifact.kind === 'html') content = source;
  else if (artifact.kind === 'svg' || artifact.kind === 'mermaid')
    content = `<img alt="${escape(artifact.title)}" style="max-width:100%;height:auto" src="data:image/svg+xml;base64,${Buffer.from(diagramSvg ?? source).toString('base64')}">`;
  else if (artifact.kind === 'markdown') {
    const [markdown, gfm] = await Promise.all([import('react-markdown'), import('remark-gfm')]);
    const allowed = new Set(images.values());
    content = renderToStaticMarkup(
      createElement(
        markdown.default,
        {
          skipHtml: true,
          remarkPlugins: [gfm.default],
          urlTransform: (url: string, key: string) =>
            key === 'src' && allowed.has(url) ? url : '',
          components: {
            a: ({ children }: any) => createElement('span', null, children),
            img: ({ src, alt }: any) =>
              src && allowed.has(src)
                ? createElement('img', { src, alt })
                : createElement('span', null, `[Image: ${alt ?? 'not loaded'}]`),
          },
        },
        source,
      ),
    );
  } else content = `<pre>${escape(source)}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${STATIC_ARTIFACT_CSP}"><title>Static artifact preview</title><style>body{font:16px system-ui;line-height:1.5;padding:24px;color:#222;background:white}pre{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px}</style></head><body>${content}</body></html>`;
}
function stripDevicePrefix(filePath: string) {
  if (filePath.startsWith('\\\\?\\UNC\\')) return `\\\\${filePath.slice(8)}`;
  if (filePath.startsWith('\\\\?\\')) return filePath.slice(4);
  return filePath;
}
function canonicalLocalFile(fileUrl: string) {
  let filePath: string;
  try {
    const url = new URL(fileUrl);
    if (url.protocol !== 'file:' || url.hostname) return null;
    filePath = fileURLToPath(url);
  } catch {
    return null;
  }
  const parent = dirname(filePath);
  let resolvedParent: string;
  try {
    resolvedParent = stripDevicePrefix(realpathSync.native(parent));
  } catch {
    resolvedParent = resolve(parent);
  }
  const candidate = join(resolvedParent, basename(filePath));
  try {
    return stripDevicePrefix(realpathSync.native(candidate));
  } catch {
    return candidate;
  }
}
function pathKey(filePath: string) {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}
/** Match one allowlisted file after decoding and realpath, not a directory prefix. */
export function fileRequestAllowed(requestUrl: string, allowedFiles: ReadonlySet<string>) {
  if (requestUrl.startsWith('data:')) return true;
  const requested = canonicalLocalFile(requestUrl);
  if (!requested) return false;
  const requestedKey = pathKey(requested);
  for (const allowed of allowedFiles) {
    const key = canonicalLocalFile(allowed);
    if (key && pathKey(key) === requestedKey) return true;
  }
  return false;
}
function isolate(window: BrowserWindow, allowedFiles = new Set<string>()) {
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  const isolated = window.webContents.session;
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', (event) => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !fileRequestAllowed(details.url, allowedFiles) }),
  );
}
function previewWindow(parent: BrowserWindow | null, javascript = false) {
  return new BrowserWindow({
    parent: parent ?? undefined,
    width: 960,
    height: 720,
    show: false,
    title: 'Static artifact preview',
    webPreferences: {
      partition: `artifact-${randomUUID()}`,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      javascript,
      devTools: false,
    },
  });
}
export async function renderDiagram(source: string, rendererPath: string) {
  validateDiagramSource(source);
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-diagram-'));
  const htmlPath = join(directory, 'index.html');
  const scriptUrl = pathToFileURL(resolve(rendererPath)).href;
  const window = previewWindow(null, true);
  isolate(window, new Set([pathToFileURL(htmlPath).href, scriptUrl]));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await writeFile(
      htmlPath,
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src file:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><script src="${escape(scriptUrl)}"></script>`,
      'utf8',
    );
    await Promise.race([
      window.loadFile(htmlPath),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          window.destroy();
          reject(
            new Error(
              'Diagram renderer could not start in time. Close other workloads and try again.',
            ),
          );
        }, 30000);
      }),
    ]);
    clearTimeout(timer);
    const operation = window.webContents.executeJavaScript(
      `window.renderArtifactDiagram(${JSON.stringify(source)})`,
      false,
    );
    const svg = await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          window.destroy();
          reject(new Error('Diagram preview timed out. Simplify the diagram and try again.'));
        }, 5000);
      }),
    ]);
    if (
      typeof svg !== 'string' ||
      Buffer.byteLength(svg) > 5 * 1024 * 1024 ||
      !svg.trim().startsWith('<svg')
    )
      throw new Error('Diagram renderer returned invalid or excessive output.');
    return svg;
  } finally {
    clearTimeout(timer);
    if (!window.isDestroyed()) window.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}
export function setupArtifactHandlers({
  runtime,
  parentWindow,
  trustedSender,
  dataDir,
  rendererPath,
}: {
  runtime: { request(route: string, input: unknown): Promise<any> };
  parentWindow: () => BrowserWindow | null;
  trustedSender: (event: IpcMainInvokeEvent) => void;
  dataDir: string;
  rendererPath: string;
}) {
  const windows = new Set<BrowserWindow>();
  async function load(id: string, revisionId?: string) {
    const view = (await runtime.request('artifactRead', { id })) as ArtifactView;
    const revision = view.revisions.find(
      (r) => r.id === (revisionId ?? view.artifact.headRevisionId),
    );
    if (!revision) throw new Error('Artifact revision not found.');
    return { view, artifact: view.artifact, revision };
  }
  async function images(revision: ArtifactRevision) {
    const result = new Map<string, string>();
    let total = 0;
    for (const id of revision.assetIds) {
      const asset = await runtime.request('asset', { id });
      if (
        !asset ||
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(asset.mime) ||
        asset.size > 25 * 1024 * 1024
      )
        throw new Error('Artifact image is missing or unsupported.');
      total += asset.size;
      if (total > 32 * 1024 * 1024) throw new Error('Artifact preview images exceed 32 MB.');
      const bytes = await readFile(join(dataDir, 'assets', id));
      if (
        bytes.length !== asset.size ||
        createHash('sha256').update(bytes).digest('hex') !== asset.hash
      )
        throw new Error('Artifact image is damaged.');
      result.set(id, `data:${asset.mime};base64,${bytes.toString('base64')}`);
    }
    return result;
  }
  async function document(artifact: Artifact, revision: ArtifactRevision) {
    const svg =
      artifact.kind === 'mermaid' ? await renderDiagram(revision.source, rendererPath) : undefined;
    return artifactDocument(artifact, revision, await images(revision), svg);
  }
  ipcMain.handle('multiclient:artifactPreview', async (event, raw) => {
    trustedSender(event);
    const input = artifactRoutes.artifactPreview.parse(raw),
      { artifact, revision } = await load(input.id, input.revisionId);
    if (windows.size >= 8) throw new Error('Close an artifact preview before opening another.');
    const html = await document(artifact, revision),
      window = previewWindow(parentWindow());
    isolate(window);
    windows.add(window);
    window.on('closed', () => windows.delete(window));
    window.on('page-title-updated', (event) => {
      event.preventDefault();
      window.setTitle(`${artifact.title} · revision ${revision.number} · Static preview`);
    });
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      window.setTitle(`${artifact.title} · revision ${revision.number} · Static preview`);
      window.show();
    } catch (error) {
      window.destroy();
      throw error;
    }
  });
  ipcMain.handle('multiclient:artifactExport', async (event, raw) => {
    trustedSender(event);
    const input = artifactRoutes.artifactExport.parse(raw),
      { view, artifact, revision } = await load(input.id, input.revisionId);
    const extension =
      input.format === 'source'
        ? {
            markdown: 'md',
            html: 'html',
            svg: 'svg',
            mermaid: 'mmd',
            code:
              (
                {
                  javascript: 'js',
                  typescript: 'ts',
                  python: 'py',
                  json: 'json',
                  css: 'css',
                } as Record<string, string>
              )[artifact.language] ?? 'txt',
            text: 'txt',
          }[artifact.kind]
        : input.format;
    if (input.format === 'svg' && !['svg', 'mermaid'].includes(artifact.kind))
      throw new Error('SVG export is available for SVG and Mermaid artifacts.');
    const selected = await dialog.showSaveDialog(parentWindow() ?? (undefined as any), {
      title: 'Export artifact revision',
      defaultPath: `${artifact.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}-r${revision.number}.${extension}`,
      filters: [{ name: input.format.toUpperCase(), extensions: [extension] }],
    });
    if (selected.canceled || !selected.filePath) return;
    if (input.format === 'source') {
      await writeFile(selected.filePath, revision.source, 'utf8');
      return;
    }
    if (input.format === 'svg') {
      const localImages =
        artifact.kind === 'svg' ? await images(revision) : new Map<string, string>();
      await writeFile(
        selected.filePath,
        artifact.kind === 'mermaid'
          ? await renderDiagram(revision.source, rendererPath)
          : revision.source.replace(
              /media:\/\/assets\/([0-9a-f-]{36})/gi,
              (_value, id: string) => localImages.get(id.toLowerCase()) ?? 'about:blank',
            ),
        'utf8',
      );
      return;
    }
    if (input.format === 'json') {
      const included = new Set(view.revisions.flatMap((r) => r.assetIds));
      const assets = [];
      let size = 0;
      for (const id of included) {
        const metadata = await runtime.request('asset', { id });
        if (
          !metadata ||
          metadata.size > 25 * 1024 * 1024 ||
          !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(metadata.mime)
        )
          throw new Error('Artifact image is missing or unsupported.');
        const bytes = await readFile(join(dataDir, 'assets', id));
        if (
          !metadata ||
          bytes.length !== metadata.size ||
          createHash('sha256').update(bytes).digest('hex') !== metadata.hash
        )
          throw new Error('Artifact image is missing or damaged.');
        size += bytes.length;
        if (size > 32 * 1024 * 1024)
          throw new Error('Artifact assets exceed the 32 MB export limit.');
        assets.push({ ...metadata, data: bytes.toString('base64') });
      }
      const portable = {
        id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        language: artifact.language,
        headRevisionId: artifact.headRevisionId,
        revisions: view.revisions.map(
          ({ id, number, parentRevisionId, source, author, createdAt, assetIds }) => ({
            id,
            number,
            parentRevisionId,
            source,
            author,
            createdAt,
            assetIds,
          }),
        ),
        references: [],
      };
      validateExportedArtifacts([portable], new Set(), included);
      const bundle = artifactBundleSchema.parse({
        format: 'multiclient-artifact',
        version: 1,
        artifact: portable,
        draft: view.draft
          ? { baseRevisionId: view.draft.baseRevisionId, source: view.draft.source }
          : null,
      });
      const data = JSON.stringify({ ...bundle, assets }, null, 2);
      if (Buffer.byteLength(data) > 64 * 1024 * 1024)
        throw new Error('Artifact export exceeds 64 MB.');
      await writeFile(selected.filePath, data, 'utf8');
      return;
    }
    const window = previewWindow(null);
    isolate(window);
    try {
      await window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(await document(artifact, revision))}`,
      );
      await window.webContents.executeJavaScript(
        'Promise.all(Array.from(document.images, image => image.decode().catch(() => {})))',
      );
      await writeFile(
        selected.filePath,
        await window.webContents.printToPDF({ printBackground: true }),
      );
    } finally {
      window.destroy();
    }
  });
  ipcMain.handle('multiclient:artifactImport', async (event) => {
    trustedSender(event);
    artifactRoutes.artifactImport.parse({});
    const selected = await dialog.showOpenDialog(parentWindow() ?? (undefined as any), {
      title: 'Import artifact',
      properties: ['openFile'],
      filters: [{ name: 'Multiclient artifact', extensions: ['json'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    if ((await stat(selected.filePaths[0])).size > 64 * 1024 * 1024)
      throw new Error('Artifact imports may be up to 64 MB.');
    const raw = JSON.parse(await readFile(selected.filePaths[0], 'utf8'));
    const { assets: _embedded, ...candidate } = raw;
    const bundle = artifactBundleSchema.parse(candidate);
    const embedded = z
      .array(
        z
          .object({
            id: z.string().uuid(),
            mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
            type: z.enum(['image', 'gif']),
            size: z
              .number()
              .int()
              .min(0)
              .max(25 * 1024 * 1024),
            hash: z.string().regex(/^[a-f0-9]{64}$/),
            data: z.string().max(36 * 1024 * 1024),
          })
          .strict(),
      )
      .max(1000)
      .parse(raw.assets ?? []);
    const mapped = new Map<string, string>(),
      bytes = new Map<string, Buffer>();
    let total = 0;
    for (const asset of embedded) {
      if (mapped.has(asset.id)) throw new Error('Duplicate artifact image.');
      const content = Buffer.from(asset.data, 'base64');
      total += content.length;
      if (
        total > 32 * 1024 * 1024 ||
        content.length !== asset.size ||
        createHash('sha256').update(content).digest('hex') !== asset.hash
      )
        throw new Error('Artifact image is damaged or exceeds the import limit.');
      const id = randomUUID();
      mapped.set(asset.id, id);
      bytes.set(id, content);
    }
    validateExportedArtifacts([bundle.artifact], new Set(), new Set(mapped.keys()));
    if (
      bundle.draft &&
      !bundle.artifact.revisions.some((r) => r.id === bundle.draft!.baseRevisionId)
    )
      throw new Error('Imported artifact draft base is missing.');
    bundle.artifact = remapArtifactAssets([bundle.artifact], mapped)[0];
    if (bundle.draft)
      bundle.draft.source = bundle.draft.source.replace(
        /media:\/\/assets\/([0-9a-f-]{36})/gi,
        (_value, id: string) => {
          const replacement = mapped.get(id.toLowerCase());
          if (!replacement) throw new Error('Imported draft image is missing.');
          return `media://assets/${replacement}`;
        },
      );
    const assets = embedded.map(({ data: _data, ...asset }) => ({
      ...asset,
      id: mapped.get(asset.id)!,
    }));
    await mkdir(join(dataDir, 'assets'), { recursive: true });
    const written: { id: string; path: string }[] = [];
    let importAttempted = false;
    try {
      for (const [id, content] of bytes) {
        const path = join(dataDir, 'assets', id);
        await writeFile(path, content, { flag: 'wx' });
        written.push({ id, path });
      }
      importAttempted = true;
      return await runtime.request('artifactImportData', { data: bundle, assets });
    } catch (error) {
      await cleanupUncommittedArtifactFiles(runtime, written, importAttempted);
      throw error;
    }
  });
  return () => {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    ipcMain.removeHandler('multiclient:artifactPreview');
    ipcMain.removeHandler('multiclient:artifactExport');
    ipcMain.removeHandler('multiclient:artifactImport');
  };
}

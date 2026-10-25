import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  nativeImage,
  Notification,
  clipboard,
} from 'electron';
import { join, resolve, extname, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, copyFile, writeFile, stat, rm } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  routes,
  providerId,
  appearanceSchema,
  attachmentSchema,
  id,
  type Route,
} from '../shared/schema';
import { contained, readText, toCanonicalPath, toCanonicalPathOrAncestor } from '../runtime/files';
import { RuntimeHost } from './runtime';
import { Secrets } from './secrets';
import { copyTextHandler } from './clipboard';
import { mediaResponse } from './media';
import { assertProviderAvailable } from '../shared/defaults';
import {
  embeddedAssets,
  markdownTranscript,
  printTranscript,
  writeBackup,
  prepareRestore,
  installRestore,
  assetSchema,
} from './history';
import { createHash as hash } from 'node:crypto';
import { contextRoutes } from '../shared/context';
import { memoryRoutes } from '../shared/memory';
import { organizationRoutes } from '../shared/organization';
import { researchRoutes } from '../shared/research';
import {
  artifactRuntimeRoutes,
  remapArtifactAssets,
  validateExportedArtifacts,
} from '../shared/artifacts';
import { comparisonRoutes } from '../shared/comparison';
import { setupArtifactHandlers } from './artifacts';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
if (process.env.MULTICLIENT_TEST_MODE === '1' && process.env.MULTICLIENT_TEST_DATA)
  app.setPath('userData', process.env.MULTICLIENT_TEST_DATA);
let window: BrowserWindow | null = null;
let host: RuntimeHost;
let quitting = false;
const diagnostics: { at: string; route: string; durationMs: number; outcome: string }[] = [];
const publicRoutes: Route[] = [
  ...(Object.keys(contextRoutes) as Route[]),
  ...(Object.keys(memoryRoutes) as Route[]),
  ...(Object.keys(organizationRoutes) as Route[]),
  ...(Object.keys(researchRoutes) as Route[]),
  ...(artifactRuntimeRoutes.filter((route) => route !== 'artifactImportData') as Route[]),
  ...(Object.keys(comparisonRoutes(attachmentSchema)) as Route[]),
  'snapshot',
  'conversationAround',
  'transcript',
  'search',
  'archivedConversations',
  'pinConversation',
  'restoreConversation',
  'branchConversation',
  'draft',
  'saveDraft',
  'projectDefaults',
  'saveProjectDefaults',
  'instructions',
  'findFiles',
  'settingsPatch',
  'testConnection',
  'createWorktree',
  'archiveWorkspace',
  'restoreWorkspace',
  'conversation',
  'createConversation',
  'archiveConversation',
  'renameConversation',
  'trustProject',
  'removeProject',
  'send',
  'cancel',
  'reply',
  'saveConnection',
  'probe',
  'models',
  'settings',
  'files',
  'readFile',
  'git',
  'terminalOpen',
  'terminalWrite',
  'terminalResize',
  'terminalClose',
];
const development = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
function trustedSender(event: Electron.IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !url
  )
    throw new Error('Untrusted IPC sender.');
  const expected = development
    ? new URL(process.env.ELECTRON_RENDERER_URL!).origin
    : 'app://client';
  if ((development ? new URL(url).origin : url.split('/').slice(0, 3).join('/')) !== expected)
    throw new Error('Untrusted IPC origin.');
}
async function external(url: string) {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('Only public web links are supported.');
  await shell.openExternal(parsed.href);
}
async function initialize() {
  if (process.platform === 'win32') app.setAppUserModelId('org.multiclient.desktop');
  const dataDir = app.getPath('userData');
  const assets = join(dataDir, 'assets');
  await mkdir(assets, { recursive: true });
  const secrets = new Secrets(join(dataDir, 'credentials'));
  host = new RuntimeHost({
    dataDir,
    migrations: app.isPackaged ? join(process.resourcesPath, 'migrations') : resolve('migrations'),
    secret: (id) => secrets.get(id),
  });
  host.on('event', (event) => {
    if (window && !window.isDestroyed()) window.webContents.send('multiclient:event', event);
    if (event.type === 'turn-status' && ['completed', 'failed', 'waiting'].includes(event.status))
      void host
        .request('snapshot')
        .then((snapshot) => {
          if (
            !snapshot.settings.notifications ||
            window?.isFocused() ||
            !Notification.isSupported()
          )
            return;
          const c = snapshot.conversations.find(
            (c: { id: string }) => c.id === event.conversationId,
          );
          new Notification({
            title: 'Multiclient',
            body: `${c?.title ?? 'Conversation'}: ${event.status === 'waiting' ? 'needs your input' : event.status}`,
          }).show();
        })
        .catch(() => {});
  });
  host.on('diagnostic', (data) => {
    diagnostics.push({
      at: new Date().toISOString(),
      route: data.route,
      durationMs: data.durationMs,
      outcome: data.outcome,
    });
    if (diagnostics.length > 256) diagnostics.shift();
  });
  await host.start();
  for (const id of ['openai', 'anthropic', 'compatible'] as const)
    await host.request('credentialState', { id, configured: !!(await secrets.get(id)) });
  const rendererRoot = resolve(__dirname, '../renderer');
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'client') return new Response('', { status: 403 });
      const root = await toCanonicalPath(rendererRoot);
      const file = resolve(
        root,
        '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
      );
      if (!contained(root, await toCanonicalPathOrAncestor(file)))
        return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(file).href);
    } catch {
      return new Response('', { status: 404 });
    }
  });
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'assets') return new Response('', { status: 403 });
      const id = z.string().uuid().parse(url.pathname.slice(1));
      const asset = await host.request('asset', { id });
      if (!asset) return new Response('', { status: 404 });
      const response = await mediaResponse(join(assets, id), asset.mime, request);
      response.headers.set(
        'Access-Control-Allow-Origin',
        development ? new URL(process.env.ELECTRON_RENDERER_URL!).origin : 'app://client',
      );
      return response;
    } catch (error) {
      if (process.env.MULTICLIENT_TEST_MODE === '1') console.error('Media response failed:', error);
      return new Response('', { status: 404 });
    }
  });
  for (const route of publicRoutes)
    ipcMain.handle(`multiclient:${route}`, async (event, input) => {
      trustedSender(event);
      return host.request(route, routes[route].parse(input));
    });
  setupArtifactHandlers({
    runtime: host,
    parentWindow: () => window,
    trustedSender,
    dataDir,
    rendererPath: join(__dirname, 'artifact-diagram.js'),
  });
  ipcMain.handle('multiclient:webCredentialStatus', async (event) => {
    trustedSender(event);
    return { configured: !!(await secrets.get('brave-search')) };
  });
  ipcMain.handle('multiclient:webSaveCredential', async (event, raw) => {
    trustedSender(event);
    const input = z
      .object({ key: z.string().max(2000), persist: z.boolean() })
      .strict()
      .parse(raw);
    return secrets.set('brave-search', input.key.trim(), input.persist);
  });
  ipcMain.handle('multiclient:addProject', async (event) => {
    trustedSender(event);
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] });
    if (result.canceled) return null;
    return host.request('addProject', { path: result.filePaths[0] });
  });
  ipcMain.handle('multiclient:attachFiles', async (event) => {
    trustedSender(event);
    const result = await dialog.showOpenDialog(window!, {
      title: 'Attach images, PDFs or text',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Text, data and code',
          extensions: [
            'txt',
            'md',
            'csv',
            'tsv',
            'json',
            'xml',
            'html',
            'yaml',
            'yml',
            'log',
            'ts',
            'tsx',
            'js',
            'jsx',
            'py',
            'css',
            'sql',
            'png',
            'jpg',
            'jpeg',
            'webp',
            'pdf',
          ],
        },
      ],
    });
    if (result.canceled) return [];
    if (result.filePaths.length > 10) throw new Error('Attach up to 10 files at a time.');
    const files = [];
    for (const path of result.filePaths) {
      files.push(await host.request('prepareAttachment', { path }));
    }
    return files;
  });
  ipcMain.handle('multiclient:attachBytes', async (event, input) => {
    trustedSender(event);
    const value = z
      .object({
        name: z.string().max(255),
        mime: z.string().max(100),
        bytes: z
          .array(z.number().int().min(0).max(255))
          .min(1)
          .max(10 * 1024 * 1024),
      })
      .strict()
      .parse(input);
    return host.request('prepareAttachmentBytes', value);
  });
  ipcMain.handle('multiclient:selectPdfPages', async (event, input) => {
    trustedSender(event);
    const value = z
      .object({
        attachment: attachmentSchema,
        pages: z.array(z.number().int().min(1)).min(1).max(100),
      })
      .parse(input);
    const asset =
      value.attachment.assetId && (await host.request('asset', { id: value.attachment.assetId }));
    if (!asset || asset.type !== 'pdf') throw new Error('Choose an imported PDF.');
    const pages = value.attachment.pages?.filter((p) => value.pages.includes(p.page)) ?? [];
    if (pages.length !== new Set(value.pages).size || !pages.some((p) => p.text.trim()))
      throw new Error(
        'Selected pages contain no extracted text. Scanned pages need document vision.',
      );
    return {
      ...value.attachment,
      pages,
      delivery: 'text',
      content: pages.map((p) => `[Page ${p.page}]\n${p.text}`).join('\n\n'),
    };
  });
  ipcMain.handle('multiclient:restartRuntime', async (event) => {
    trustedSender(event);
    await host.restart();
  });
  ipcMain.handle('multiclient:copyText', copyTextHandler(clipboard, trustedSender));
  ipcMain.handle('multiclient:exportDiagnostics', async (event) => {
    trustedSender(event);
    const snapshot = await host.request('snapshot');
    const chosen = await dialog.showSaveDialog(window!, {
      defaultPath: 'multiclient-diagnostics.json',
      filters: [{ name: 'Diagnostics JSON', extensions: ['json'] }],
    });
    if (chosen.canceled || !chosen.filePath) return;
    await writeFile(
      chosen.filePath,
      JSON.stringify(
        {
          format: 'multiclient-diagnostics',
          version: 1,
          applicationVersion: app.getVersion(),
          platform: process.platform,
          electron: process.versions.electron,
          providers: snapshot.availability.map((a: any) => ({
            id: a.id,
            version: a.version,
            status: a.status,
            modes: a.capabilities.modes.map((m: any) => m.id),
          })),
          requests: diagnostics,
        },
        null,
        2,
      ),
    );
  });
  ipcMain.handle('multiclient:openFile', async (event, input) => {
    trustedSender(event);
    const value = z
      .object({
        projectId: id,
        path: z.string().max(4096),
        line: z.number().int().min(1).max(1000000).optional(),
      })
      .strict()
      .parse(input);
    const content = await host.request('readFile', {
      projectId: value.projectId,
      path: value.path,
    });
    if (window && !window.isDestroyed())
      window.webContents.send('multiclient:event', { type: 'file-open', ...value, content });
  });
  ipcMain.handle('multiclient:exportConversation', async (event, input) => {
    trustedSender(event);
    const value = z.object({ id, format: z.enum(['markdown', 'json', 'pdf']) }).parse(input);
    const data = await host.request('exportData', { id: value.id });
    const extension = value.format === 'markdown' ? 'md' : value.format;
    const result = await dialog.showSaveDialog(window!, {
      defaultPath: `${data.conversation.title.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 80) || 'conversation'}.${extension}`,
    });
    if (result.canceled || !result.filePath) return;
    if (value.format === 'markdown')
      await writeFile(result.filePath, markdownTranscript(data.conversation, data.messages));
    else if (value.format === 'json') {
      // Every successful JSON export must fit the same contract its importer accepts.
      routes.importData.parse({ data });
      const json = JSON.stringify(
        { ...data, assets: await embeddedAssets(dataDir, data.assets) },
        null,
        2,
      );
      if (Buffer.byteLength(json, 'utf8') > 64 * 1024 * 1024)
        throw new Error(
          'Restorable conversation JSON may be up to 64 MB. Use a profile backup for larger histories.',
        );
      await writeFile(result.filePath, json);
    } else {
      const print = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
      });
      try {
        await print.loadURL(
          'data:text/html;charset=utf-8,' +
            encodeURIComponent(await printTranscript(data.conversation, data.messages)),
        );
        await print.webContents.executeJavaScript(
          'Promise.all(Array.from(document.images, image => image.decode().catch(() => undefined)))',
        );
        await writeFile(
          result.filePath,
          await print.webContents.printToPDF({ printBackground: false }),
        );
      } finally {
        print.destroy();
      }
    }
  });
  ipcMain.handle('multiclient:importConversation', async (event) => {
    trustedSender(event);
    const chosen = await dialog.showOpenDialog(window!, {
      properties: ['openFile'],
      filters: [{ name: 'Multiclient conversation', extensions: ['json'] }],
    });
    if (chosen.canceled) return null;
    if ((await stat(chosen.filePaths[0])).size > 64 * 1024 * 1024)
      throw new Error('Conversation exports may be up to 64 MB.');
    const raw = JSON.parse(await readFile(chosen.filePaths[0], 'utf8'));
    const data = routes.importData.parse({ data: { ...raw, assets: undefined } }).data;
    const embedded = z
      .array(assetSchema)
      .max(1000)
      .parse(raw.assets ?? []);
    const mapped = new Map<string, string>();
    for (const asset of embedded) {
      if (mapped.has(asset.id)) throw new Error('Duplicate exported asset.');
      const bytes = Buffer.from(asset.data, 'base64');
      if (bytes.length !== asset.size || hash('sha256').update(bytes).digest('hex') !== asset.hash)
        throw new Error('An exported asset is damaged.');
      const newId = randomUUID();
      mapped.set(asset.id, newId);
    }
    for (const a of [
      ...data.messages.flatMap((message) => message.attachments ?? []),
      ...(data.draft?.attachments ?? []),
    ])
      if (a.assetId) {
        const newId = mapped.get(a.assetId);
        if (!newId) throw new Error('An exported attachment is missing.');
        a.assetId = newId;
      }
    const snapshotIds = new Map<string, string>();
    const allSources = [
      ...data.messages.flatMap((message) => message.contextSources ?? []),
      ...(data.contextSnapshots ?? []),
    ];
    for (const source of allSources)
      if (!snapshotIds.has(source.id)) snapshotIds.set(source.id, randomUUID());
    const remapCitations = (text: string) =>
      text.replace(
        /\[\[source:([0-9a-f-]{36}):(\d+)\]\]/gi,
        (token, sourceId: string, paragraph: string) =>
          snapshotIds.has(sourceId)
            ? `[[source:${snapshotIds.get(sourceId)}:${paragraph}]]`
            : token,
      );
    for (const source of allSources) {
      source.id = snapshotIds.get(source.id)!;
      if (source.source?.assetId) {
        const assetId = mapped.get(source.source.assetId);
        if (!assetId) throw new Error('An exported source asset is missing.');
        source.source.assetId = assetId;
      }
    }
    if (data.draft) {
      data.draft.contextRefs = data.draft.contextRefs?.map((ref) => {
        const snapshotId = snapshotIds.get(ref.snapshotId);
        if (!snapshotId) throw new Error('An exported draft source is missing.');
        return { ...ref, snapshotId };
      });
      data.draft.excludedContextSnapshotIds = data.draft.excludedContextSnapshotIds?.map((id) => {
        const snapshotId = snapshotIds.get(id);
        if (!snapshotId) throw new Error('An exported draft source is missing.');
        return snapshotId;
      });
    }
    for (const message of data.messages) {
      message.text = remapCitations(message.text);
      if (message.context) message.context = remapCitations(message.context);
      for (const block of message.blocks ?? []) block.text = remapCitations(block.text);
      if (message.sourceCitations) {
        message.sourceCitations.sources = message.sourceCitations.sources.map((sourceId) => {
          const id = snapshotIds.get(sourceId);
          if (!id) throw new Error('An exported citation source is missing.');
          return id;
        });
        message.sourceCitations.valid = message.sourceCitations.valid.map((citation) => {
          const snapshotId = snapshotIds.get(citation.snapshotId);
          if (!snapshotId) throw new Error('An exported citation source is missing.');
          return { ...citation, snapshotId, token: remapCitations(citation.token) };
        });
        message.sourceCitations.unresolved = message.sourceCitations.unresolved.map(remapCitations);
      }
    }
    if (data.artifacts) {
      validateExportedArtifacts(
        data.artifacts,
        new Set(data.messages.flatMap((message) => (message.id ? [message.id] : []))),
        new Set(mapped.keys()),
      );
      data.artifacts = remapArtifactAssets(data.artifacts, mapped);
    }
    const written: string[] = [];
    try {
      for (const asset of embedded) {
        const newId = mapped.get(asset.id)!;
        await writeFile(join(assets, newId), Buffer.from(asset.data, 'base64'), { flag: 'wx' });
        written.push(newId);
      }
    } catch (error) {
      for (const assetId of written) await rm(join(assets, assetId), { force: true });
      throw error;
    }
    data.assets = embedded.map(({ data: _bytes, ...asset }) => ({
      ...asset,
      id: mapped.get(asset.id)!,
    }));
    // Register the remapped assets and messages together in one SQLite transaction.
    try {
      return await host.request('importData', { data });
    } catch (error) {
      for (const assetId of written) {
        try {
          // A lost response may follow a committed transaction; preserve registered assets.
          if (!(await host.request('asset', { id: assetId })))
            await rm(join(assets, assetId), { force: true });
        } catch {
          // Retain files while the transaction outcome cannot be verified.
        }
      }
      throw error;
    }
  });
  ipcMain.handle('multiclient:backup', async (event) => {
    trustedSender(event);
    const chosen = await dialog.showSaveDialog(window!, {
      defaultPath: 'multiclient-backup.mcb',
      filters: [{ name: 'Multiclient backup', extensions: ['mcb'] }],
    });
    if (!chosen.canceled && chosen.filePath) await writeBackup(host, dataDir, chosen.filePath);
  });
  ipcMain.handle('multiclient:restoreBackup', async (event) => {
    trustedSender(event);
    const current = await host.request('snapshot');
    if (current.activeTurns.length)
      throw new Error('Stop active responses before restoring a backup.');
    const chosen = await dialog.showOpenDialog(window!, {
      properties: ['openFile'],
      filters: [{ name: 'Multiclient backup', extensions: ['mcb'] }],
    });
    if (chosen.canceled) return;
    const temporary = await prepareRestore(host, dataDir, chosen.filePaths[0]);
    const confirm = await dialog.showMessageBox(window!, {
      type: 'question',
      buttons: ['Restore', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Restore this verified backup?',
      detail:
        'The current profile will be saved locally for recovery. Conversations and settings will be replaced. Credentials are kept separate.',
    });
    if (confirm.response !== 0) {
      const { rm } = await import('node:fs/promises');
      await rm(temporary, { recursive: true, force: true });
      return;
    }
    if ((await host.request('snapshot')).activeTurns.length) {
      const { rm } = await import('node:fs/promises');
      await rm(temporary, { recursive: true, force: true });
      throw new Error('Stop active responses before restoring a backup.');
    }
    await installRestore(host, dataDir, temporary);
    for (const id of ['openai', 'anthropic', 'compatible'] as const)
      await host.request('credentialState', {
        id,
        configured: !!(await secrets.get(id)),
        changed: true,
      });
    window?.webContents.reload();
  });
  ipcMain.handle('multiclient:saveCredential', async (event, input) => {
    trustedSender(event);
    const value = z
      .object({ id: providerId, key: z.string().max(20000), persist: z.boolean() })
      .strict()
      .parse(input);
    assertProviderAvailable(value.id);
    const result = await secrets.set(value.id, value.key.trim(), value.persist);
    await host.request('credentialState', {
      id: value.id,
      configured: !!value.key.trim(),
      changed: true,
    });
    return result;
  });
  ipcMain.handle('multiclient:login', async (event, input) => {
    trustedSender(event);
    const value = z.object({ id: providerId }).parse(input);
    const result = await host.request('login', value);
    if (result.url) {
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com'].includes(url.hostname))
        throw new Error('Provider returned an unexpected login destination.');
      await external(result.url);
    }
    return result;
  });
  ipcMain.handle('multiclient:openExternal', async (event, input) => {
    trustedSender(event);
    await external(z.string().url().max(4096).parse(input));
  });
  ipcMain.handle('multiclient:windowTheme', (event, input) => {
    trustedSender(event);
    const theme = z.enum(['light', 'dark', 'media']).parse(input);
    if (process.platform !== 'darwin')
      window!.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: theme === 'light' ? '#302e29' : '#ffffff',
      });
  });
  ipcMain.handle('multiclient:importBackground', async (event) => {
    trustedSender(event);
    const result = await dialog.showOpenDialog(window!, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Images and videos',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'],
        },
      ],
    });
    if (result.canceled) return null;
    const source = result.filePaths[0];
    const info = await stat(source);
    if (info.size > 100 * 1024 * 1024) throw new Error('Choose a background smaller than 100 MB.');
    const ext = extname(source).toLowerCase();
    const video = ['.mp4', '.webm'].includes(ext);
    const gif = ext === '.gif';
    const id = randomUUID();
    const mime = (
      {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
      } as Record<string, string>
    )[ext];
    if (!mime) throw new Error('Unsupported media format.');
    if (!video && !gif && ext !== '.webp' && nativeImage.createFromPath(source).isEmpty())
      throw new Error('The image could not be decoded.');
    await copyFile(source, join(assets, id));
    const bytes = await readFile(join(assets, id));
    if (gif && !/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')))
      throw new Error('Invalid GIF image.');
    if (
      ext === '.webp' &&
      (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
        bytes.subarray(8, 12).toString('ascii') !== 'WEBP')
    )
      throw new Error('Invalid WebP image.');
    await host.request('registerAsset', {
      id,
      mime,
      type: video ? 'video' : gif ? 'gif' : 'image',
      size: info.size,
      hash: createHash('sha256').update(bytes).digest('hex'),
    });
    return { id, mime, type: video ? 'video' : gif ? 'gif' : 'image' };
  });
  ipcMain.handle('multiclient:importTheme', async (event) => {
    trustedSender(event);
    const result = await dialog.showOpenDialog(window!, {
      properties: ['openFile'],
      filters: [{ name: 'Theme JSON', extensions: ['json'] }],
    });
    if (result.canceled) return null;
    if ((await stat(result.filePaths[0])).size > 10000) throw new Error('Theme file is too large.');
    const theme = appearanceSchema.parse(JSON.parse(await readFile(result.filePaths[0], 'utf8')));
    return { ...theme, background: null };
  });
  ipcMain.handle('multiclient:exportTheme', async (event, input) => {
    trustedSender(event);
    const theme = appearanceSchema.parse(input);
    const result = await dialog.showSaveDialog(window!, {
      defaultPath: 'multiclient-theme.json',
      filters: [{ name: 'Theme JSON', extensions: ['json'] }],
    });
    if (!result.canceled && result.filePath)
      await writeFile(result.filePath, JSON.stringify({ ...theme, background: null }, null, 2));
  });
  createWindow();
}
function createWindow() {
  window = new BrowserWindow({
    title: 'Multiclient',
    icon: join(
      app.isPackaged ? join(process.resourcesPath, 'icons') : resolve('resources'),
      process.platform === 'win32' ? 'icon.ico' : 'icon.png',
    ),
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#faf9f6',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: '#00000000', symbolColor: '#302e29', height: 42 } }
      : {}),
    roundedCorners: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_web, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    window = null;
  });
  if (development) void window.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else void window.loadURL('app://client/index.html');
}
const singleton = app.requestSingleInstanceLock();
if (!singleton) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(initialize)
    .catch((e) => {
      if (process.env.MULTICLIENT_TEST_MODE === '1') {
        console.error(e);
        app.exit(1);
      } else {
        dialog.showErrorBox(
          'Multiclient could not start',
          e instanceof Error ? e.message : String(e),
        );
        app.quit();
      }
    });
  app.on('activate', () => {
    if (!window && host) createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void host?.stop().finally(() => app.quit());
  });
}

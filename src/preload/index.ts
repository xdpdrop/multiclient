import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, RuntimeEvent, RuntimeStateEvent } from '../shared/types';
import { createOrganizationApi } from './features/organization';
import { memoryApi } from './features/memory';
import { artifactsApi } from './features/artifacts';
import { createResearchApi } from './features/research';
import { comparisonApi } from './features/comparison';
const invoke = (route: string, input: unknown = {}) =>
  ipcRenderer.invoke(`multiclient:${route}`, input);
const api: DesktopApi = {
  ...createOrganizationApi(invoke),
  ...memoryApi(invoke),
  ...artifactsApi(invoke),
  ...createResearchApi(invoke),
  ...comparisonApi(invoke),
  createChatProject: (name) => invoke('createChatProject', { name }),
  renameProject: (id, name) => invoke('renameProject', { id, name }),
  contextItems: (projectId, kind) => invoke('contextItems', { projectId, kind }),
  contextItem: (id) => invoke('contextItem', { id }),
  saveContextItem: (item) => invoke('saveContextItem', item),
  removeContextItem: (id, expectedRevision) =>
    invoke('removeContextItem', { id, expectedRevision }),
  contextSnapshot: (id) => invoke('contextSnapshot', { id }),
  contextSnapshots: (ids) => invoke('contextSnapshots', { ids }),
  conversationContextSources: (conversationId) =>
    invoke('conversationContextSources', { id: conversationId }),
  snapshotContextItems: (ids) => invoke('snapshotContextItems', { ids }),
  projectContextDefaults: (projectId) => invoke('projectContextDefaults', { projectId }),
  platform: process.platform,
  windowTheme: (theme) => invoke('windowTheme', theme),
  snapshot: () => invoke('snapshot'),
  conversation: (id, before) => invoke('conversation', { id, before }),
  conversationAround: (id, messageId) => invoke('conversationAround', { id, messageId }),
  transcript: (id) => invoke('transcript', { id }),
  search: (query, filters) => invoke('search', { query, ...filters }),
  archivedConversations: () => invoke('archivedConversations'),
  pinConversation: (id, pinned) => invoke('pinConversation', { id, pinned }),
  restoreConversation: (id) => invoke('restoreConversation', { id }),
  branchConversation: (id, messageId, edit) =>
    invoke('branchConversation', { id, messageId, edit }),
  exportConversation: (id, format) => invoke('exportConversation', { id, format }),
  importConversation: () => invoke('importConversation'),
  backup: () => invoke('backup'),
  restoreBackup: () => invoke('restoreBackup'),
  draft: (key) => invoke('draft', { key }),
  saveDraft: (key, draft) => invoke('saveDraft', { key, draft }),
  restartRuntime: () => invoke('restartRuntime'),
  exportDiagnostics: () => invoke('exportDiagnostics'),
  copyText: (text) => invoke('copyText', { text }),
  createConversation: (projectId, workspaceId) =>
    invoke('createConversation', { projectId, workspaceId }),
  createWorktree: (projectId, sourceRef) => invoke('createWorktree', { projectId, sourceRef }),
  archiveWorkspace: (workspaceId) => invoke('archiveWorkspace', { workspaceId }),
  restoreWorkspace: (workspaceId) => invoke('restoreWorkspace', { workspaceId }),
  archiveConversation: (id) => invoke('archiveConversation', { id }),
  renameConversation: (id, title) => invoke('renameConversation', { id, title }),
  addProject: () => invoke('addProject'),
  trustProject: (id, trusted) => invoke('trustProject', { id, trusted }),
  removeProject: (id) => invoke('removeProject', { id }),
  send: (input) => invoke('send', input),
  cancel: (conversationId) => invoke('cancel', { conversationId }),
  reply: (input) => invoke('reply', input),
  saveConnection: (input) => invoke('saveConnection', input),
  saveCredential: (id, key, persist) => invoke('saveCredential', { id, key, persist }),
  login: (id) => invoke('login', { id }),
  probe: () => invoke('probe'),
  models: (id) => invoke('models', { id }),
  testConnection: (id) => invoke('testConnection', { id }),
  attachFiles: () => invoke('attachFiles'),
  attachBytes: (input) => invoke('attachBytes', input),
  selectPdfPages: (attachment, pages) => invoke('selectPdfPages', { attachment, pages }),
  settings: (input) => invoke('settings', input),
  settingsPatch: (patch) => invoke('settingsPatch', patch),
  importBackground: () => invoke('importBackground'),
  importTheme: () => invoke('importTheme'),
  exportTheme: (appearance) => invoke('exportTheme', appearance),
  files: (projectId, path) => invoke('files', { projectId, path }),
  readFile: (projectId, path) => invoke('readFile', { projectId, path }),
  openFile: (projectId, path, line) => invoke('openFile', { projectId, path, line }),
  findFiles: (projectId, query) => invoke('findFiles', { projectId, query }),
  projectDefaults: (projectId) => invoke('projectDefaults', { projectId }),
  saveProjectDefaults: (projectId, defaults) =>
    invoke('saveProjectDefaults', { projectId, defaults }),
  instructions: (projectId) => invoke('instructions', { projectId }),
  git: (projectId) => invoke('git', { projectId }),
  terminalOpen: (projectId) => invoke('terminalOpen', { projectId }),
  terminalWrite: (id, data) => invoke('terminalWrite', { id, data }),
  terminalResize: (id, cols, rows) => invoke('terminalResize', { id, cols, rows }),
  terminalClose: (id) => invoke('terminalClose', { id }),
  openExternal: (url) => invoke('openExternal', url),
  onEvent: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, event: RuntimeEvent | RuntimeStateEvent) =>
      callback(event);
    ipcRenderer.on('multiclient:event', handler);
    return () => {
      ipcRenderer.removeListener('multiclient:event', handler);
    };
  },
};
contextBridge.exposeInMainWorld('desktop', api);

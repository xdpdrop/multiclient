import type { ContextApi, ContextRef, ContextSnapshot } from './context';
import type { OrganizationApi, ConversationTag } from './organization';
import type { MemoryApi } from './memory';
import type { ResearchApi } from './research';
import type { ArtifactsApi, ArtifactReference } from './artifacts';
import type { ComparisonApi } from './comparison';
import type { ResearchEvent, SourceCitationAudit } from './research';

export type ProviderId =
  'codex' | 'claude-code' | 'cursor' | 'openai' | 'anthropic' | 'compatible' | 'demo';
export type CredentialId = ProviderId | 'brave-search';
export type Mode = {
  id: string;
  label: string;
  intent: 'chat' | 'ask' | 'agent' | 'plan' | 'review';
  implementation: 'native' | 'app-workflow';
  workspaceAccess: 'none' | 'read' | 'write';
};
export type Capabilities = {
  modes: Mode[];
  resume: 'native' | 'transcript' | 'none';
  cancellation: 'protocol' | 'process' | 'request';
  approvals: boolean;
  userQuestions: boolean;
  modelDiscovery: boolean;
  inputKinds: ('text' | 'file-reference' | 'image' | 'pdf')[];
};
export type Connection = {
  id: ProviderId;
  name: string;
  kind: 'cli-agent' | 'api-chat';
  executable: string;
  endpoint: string;
  model: string;
  enabled: boolean;
  configured: boolean;
};
export type ModelOption = {
  id: string;
  label: string;
  efforts: string[];
  inputKinds?: Capabilities['inputKinds'];
  contextWindow?: number;
};
export type Attachment = {
  path: string;
  content: string;
  kind?: 'text' | 'image' | 'pdf';
  assetId?: string;
  name?: string;
  mime?: string;
  size?: number;
  pages?: { page: number; text: string }[];
  delivery?: 'native' | 'text';
};
export type Draft = {
  text: string;
  attachments: Attachment[];
  provider: ProviderId;
  model: string;
  mode: string;
  effort: string;
  customModel?: boolean;
  historyMessageIds?: string[];
  contextRefs?: ContextRef[];
  excludedContextSnapshotIds?: string[];
  artifactReferences?: ArtifactReference[];
};
export type QuestionAnswer = { selected: string[]; text: string };
export type ErrorInfo = { code: string; message: string; retryable: boolean; action?: string };
export type ConnectionUsage = {
  checkedAt: string;
  windows: { id: string; label: string; remainingPercent: number; resetsAt?: number }[];
};
export type Availability = {
  id: ProviderId;
  installed: boolean;
  status: 'ready' | 'sign-in' | 'not-installed' | 'error' | 'unknown';
  version?: string;
  path?: string;
  detail: string;
  capabilities: Capabilities;
  usage?: ConnectionUsage;
  test?: { checkedAt: string; passed: boolean; detail: string };
};
export type Project = {
  id: string;
  name: string;
  kind: 'folder' | 'chat';
  workspaceId: string | null;
  path: string | null;
  trusted: boolean;
};
export type Workspace = {
  id: string;
  projectId: string;
  path: string;
  trusted: boolean;
  kind: 'primary' | 'worktree';
  branch: string;
  sourceRef: string;
  sourceWorkspaceId: string | null;
  archived: boolean;
};
export type Conversation = {
  id: string;
  projectId: string | null;
  workspaceId: string | null;
  title: string;
  providerId: ProviderId;
  model: string;
  mode: string;
  effort: string;
  updatedAt: string;
  archived: boolean;
  pinned?: boolean;
  parentConversationId?: string | null;
  parentMessageId?: string | null;
  lastStatus?: TurnStatus;
  lastError?: string;
  connectionChanged?: boolean;
  tags?: ConversationTag[];
};
export type Message = {
  sequence?: number;
  id: string;
  conversationId: string;
  sessionId: string;
  turnId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  context?: string;
  blocks?: ResponseBlock[];
  status: string;
  providerId: ProviderId;
  createdAt: string;
  attachments?: Attachment[];
  errorInfo?: ErrorInfo;
  contextSources?: ContextSnapshot[];
  artifactReferences?: ArtifactReference[];
  sourceCitations?: SourceCitationAudit;
};
export type ResponseBlock = { id: string; phase: 'commentary' | 'answer'; text: string };
export type ToolActivity = {
  id: string;
  title: string;
  detail: string;
  status: 'running' | 'completed' | 'failed';
};
export type ConversationActivity = ToolActivity & { turnId: string };
export type Interaction = {
  id: string;
  conversationId: string;
  sessionId: string;
  turnId: string;
  kind: 'approval' | 'question' | 'plan';
  title: string;
  detail: string;
  questions?: {
    id: string;
    prompt: string;
    options: string[];
    multiple?: boolean;
    allowFreeText?: boolean;
  }[];
  status: 'pending' | 'resolved' | 'cancelled';
};
export type InteractionReply = {
  id: string;
  allow: boolean;
  answers?: Record<string, string | QuestionAnswer>;
};
export type ProviderInteractionReply = {
  id: string;
  allow: boolean;
  answers?: Record<string, string>;
};
export type Appearance = {
  theme: 'light' | 'dark' | 'system';
  background: string | null;
  backgroundType: 'image' | 'video' | 'gif';
  backgroundOpacity: number;
  surfaceOpacity: number;
  dimming: number;
  blur: number;
  reducedMotion: boolean;
};
export type Settings = {
  appearance: Appearance;
  sidebarCollapsed: boolean;
  terminalOpen: boolean;
  fontSize?: number;
  density?: 'comfortable' | 'compact';
  notifications?: boolean;
};
export type SettingsPatch = Partial<Omit<Settings, 'appearance'>> & {
  appearance?: Partial<Appearance>;
};
export type TurnStatus =
  'starting' | 'running' | 'waiting' | 'completed' | 'cancelled' | 'interrupted' | 'failed';
export type Turn = {
  id: string;
  conversationId: string;
  sessionId: string;
  status: TurnStatus;
  error?: string;
  errorInfo?: ErrorInfo;
  createdAt?: string;
};
export type Snapshot = {
  workspaces?: Workspace[];
  projects: Project[];
  conversations: Conversation[];
  connections: Connection[];
  availability: Availability[];
  settings: Settings;
  activeTurns: Turn[];
};
export type ConversationView = {
  currentSessionId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; checkedAt: string };
  conversation: Conversation;
  messages: Message[];
  interactions: Interaction[];
  tools: ConversationActivity[];
  cursor: number;
  hasMore: boolean;
};
export type FileEntry = { name: string; path: string; directory: boolean };
export type GitState = {
  branch: string;
  entries: { path: string; status: string }[];
  diff: string;
  error?: string;
  files?: GitFileChange[];
};
export type GitDiffPreview = {
  text: string;
  kind: 'text' | 'binary' | 'oversize' | 'unavailable';
  detail?: string;
};
export type GitFileChange = {
  path: string;
  status: string;
  staged?: GitDiffPreview;
  unstaged?: GitDiffPreview;
  untracked?: GitDiffPreview;
};
export type SearchResult = {
  conversationId: string;
  title: string;
  messageId: string | null;
  snippet: string;
  providerId: ProviderId;
  projectId: string | null;
  archived: boolean;
  createdAt: string;
};
export type RuntimeEvent =
  | ResearchEvent
  | { type: 'changed' }
  | { type: 'turn-status'; conversationId: string; status: TurnStatus }
  | { type: 'file-open'; projectId: string; path: string; line?: number; content: string }
  | { type: 'conversation'; conversationId: string; cursor: number }
  | { type: 'terminal'; terminalId: string; data: string }
  | { type: 'terminal-exit'; terminalId: string; code: number }
  | { type: 'runtime-error'; message: string };
// Runtime recovery never replays a model request or a permission response.
export type RuntimeStateEvent = {
  type: 'runtime-state';
  status: 'recovering' | 'ready' | 'failed';
  message: string;
};
export type ProviderEvent =
  | { type: 'text'; text: string; itemId?: string; phase?: ResponseBlock['phase'] }
  | { type: 'session'; nativeId: string }
  | { type: 'tool'; tool: ToolActivity }
  | { type: 'usage'; data: Record<string, unknown> }
  | { type: 'warning'; message: string };
export type SendInput = {
  conversationId: string;
  requestId: string;
  text: string;
  providerId: ProviderId;
  model: string;
  mode: string;
  effort?: string;
  handoff?: string;
  historyMessageIds?: string[];
  contextRefs?: ContextRef[];
  excludedContextSnapshotIds?: string[];
  artifactReferences?: ArtifactReference[];
  attachments: Attachment[];
};
export type Asset = { id: string; mime: string; type: 'image' | 'video' | 'gif' };
export type DesktopApi = ContextApi &
  OrganizationApi &
  MemoryApi &
  ResearchApi &
  ArtifactsApi &
  ComparisonApi & {
    platform: string;
    windowTheme(theme: 'light' | 'dark' | 'media'): Promise<void>;
    snapshot(): Promise<Snapshot>;
    conversation(id: string, before?: string): Promise<ConversationView>;
    conversationAround(id: string, messageId: string): Promise<ConversationView>;
    transcript(id: string): Promise<Message[]>;
    search(
      query: string,
      filters?: {
        projectId?: string;
        providerId?: ProviderId;
        archived?: boolean;
        conversationId?: string;
        tagIds?: string[];
      },
    ): Promise<SearchResult[]>;
    pinConversation(id: string, pinned: boolean): Promise<void>;
    restoreConversation(id: string): Promise<void>;
    archivedConversations(): Promise<Conversation[]>;
    branchConversation(id: string, messageId: string, edit?: boolean): Promise<Conversation>;
    exportConversation(id: string, format: 'markdown' | 'json' | 'pdf'): Promise<void>;
    importConversation(): Promise<Conversation | null>;
    backup(): Promise<void>;
    restoreBackup(): Promise<void>;
    draft(key: string): Promise<Draft | null>;
    saveDraft(key: string, draft: Draft | null): Promise<void>;
    restartRuntime(): Promise<void>;
    exportDiagnostics(): Promise<void>;
    copyText(text: string): Promise<void>;
    createConversation(projectId?: string, workspaceId?: string): Promise<Conversation>;
    createWorktree(projectId: string, sourceRef: string): Promise<Workspace>;
    archiveWorkspace(workspaceId: string): Promise<void>;
    restoreWorkspace(workspaceId: string): Promise<void>;
    archiveConversation(id: string): Promise<void>;
    renameConversation(id: string, title: string): Promise<void>;
    addProject(): Promise<Project | null>;
    trustProject(id: string, trusted: boolean): Promise<void>;
    removeProject(id: string): Promise<void>;
    send(input: SendInput): Promise<Turn>;
    cancel(conversationId: string): Promise<void>;
    reply(reply: InteractionReply): Promise<void>;
    saveConnection(connection: Connection): Promise<void>;
    saveCredential(id: ProviderId, key: string, persist: boolean): Promise<{ persisted: boolean }>;
    login(id: ProviderId): Promise<{ url?: string; message: string }>;
    probe(): Promise<Availability[]>;
    testConnection(id: ProviderId): Promise<{ message: string }>;
    models(id: ProviderId): Promise<ModelOption[]>;
    attachFiles(): Promise<Attachment[]>;
    attachBytes(input: { name: string; mime: string; bytes: number[] }): Promise<Attachment>;
    selectPdfPages(attachment: Attachment, pages: number[]): Promise<Attachment>;
    settings(settings: Settings): Promise<void>;
    settingsPatch(patch: SettingsPatch): Promise<Settings>;
    importBackground(): Promise<Asset | null>;
    importTheme(): Promise<Appearance | null>;
    exportTheme(appearance: Appearance): Promise<void>;
    files(projectId: string, path: string): Promise<FileEntry[]>;
    readFile(projectId: string, path: string): Promise<string>;
    openFile(projectId: string, path: string, line?: number): Promise<void>;
    findFiles(projectId: string, query: string): Promise<FileEntry[]>;
    projectDefaults(projectId: string): Promise<Partial<Draft>>;
    saveProjectDefaults(projectId: string, defaults: Partial<Draft>): Promise<void>;
    instructions(projectId: string): Promise<{ path: string; content: string }[]>;
    git(projectId: string): Promise<GitState>;
    terminalOpen(projectId: string): Promise<string>;
    terminalWrite(id: string, data: string): Promise<void>;
    terminalResize(id: string, cols: number, rows: number): Promise<void>;
    terminalClose(id: string): Promise<void>;
    openExternal(url: string): Promise<void>;
    onEvent(callback: (event: RuntimeEvent | RuntimeStateEvent) => void): () => void;
  };

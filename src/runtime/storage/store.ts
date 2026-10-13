import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
  capabilities,
  connections,
  defaultSettings,
  isProviderAvailable,
} from '../../shared/defaults';
import { settingsSchema, draftSchema } from '../../shared/schema';
import { contextSnapshotSchema, type ContextSnapshot } from '../../shared/context';
import {
  copyArtifactReferences,
  exportConversationArtifacts,
  importConversationArtifacts,
} from '../artifacts/store';
import type { ArtifactReference, ExportedArtifact } from '../../shared/artifacts';
import { OrganizationService } from '../organization';
import { sourceCitationAuditSchema } from '../../shared/research';
import type {
  Connection,
  Conversation,
  ConversationView,
  Interaction,
  Message,
  Project,
  ProviderId,
  ResponseBlock,
  Settings,
  ConversationActivity,
  Turn,
  TurnStatus,
  Draft,
  Attachment,
  ErrorInfo,
  SettingsPatch,
  SearchResult,
  Workspace,
} from '../../shared/types';

type Session = {
  id: string;
  providerId: ProviderId;
  nativeId: string | null;
  model: string;
  mode: string;
  configurationRevision: string;
};
const now = () => new Date().toISOString();
const convSelect =
  'SELECT id, project_id AS projectId, workspace_id AS workspaceId, title, provider_id AS providerId, model, mode, effort, updated_at AS updatedAt, archived, pinned, parent_conversation_id AS parentConversationId, parent_message_id AS parentMessageId, (SELECT status FROM turns WHERE conversation_id=conversations.id ORDER BY rowid DESC LIMIT 1) AS lastStatus, (SELECT error FROM turns WHERE conversation_id=conversations.id ORDER BY rowid DESC LIMIT 1) AS lastError FROM conversations';
const msgSelect =
  'SELECT seq AS sequence, id, conversation_id AS conversationId, session_id AS sessionId, turn_id AS turnId, role, text, status, provider_id AS providerId, created_at AS createdAt FROM messages';

export class Store {
  readonly db: Database.Database;
  constructor(path: string, migrations: string) {
    this.db = new Database(path);
    try {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 5000');
      const exists = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
        .get();
      let version = exists
        ? (
            this.db
              .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
              .get() as { version: number }
          ).version
        : 0;
      for (const file of readdirSync(migrations)
        .filter((f) => /^\d+.*\.sql$/.test(f))
        .sort()) {
        const next = Number(file.split('_')[0]);
        if (next <= version) continue;
        const rebuildWorkspaces = next === 4;
        if (rebuildWorkspaces) this.db.pragma('foreign_keys=OFF');
        try {
          this.db.transaction(() => {
            this.db.exec(readFileSync(join(migrations, file), 'utf8'));
            if ((this.db.pragma('foreign_key_check') as unknown[]).length)
              throw new Error('Migration produced invalid references.');
            this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(next, now());
          })();
        } finally {
          if (rebuildWorkspaces) this.db.pragma('foreign_keys=ON');
        }
        version = next;
      }
      for (const c of connections)
        this.db
          .prepare('INSERT OR IGNORE INTO provider_connections VALUES (?, ?)')
          .run(c.id, JSON.stringify(c));
      // Existing native sessions retain their mapping when this migration is first opened.
      for (const c of this.connections())
        this.db
          .prepare(
            "UPDATE provider_sessions SET configuration_revision=? WHERE provider_id=? AND configuration_revision=''",
          )
          .run(this.configurationRevision(c.id), c.id);
      this.db.transaction(() => {
        this.db
          .prepare(
            "UPDATE turns SET status='interrupted', error='The app closed before this turn finished.', ended_at=? WHERE status IN ('starting', 'running', 'waiting')",
          )
          .run(now());
        this.db.prepare("UPDATE messages SET status='interrupted' WHERE status='streaming'").run();
        this.db.prepare("UPDATE interactions SET status='cancelled' WHERE status='pending'").run();
      })();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  projects(): Project[] {
    return (
      this.db
        .prepare(
          "SELECT p.id, p.name, p.kind, w.id AS workspaceId, w.path, COALESCE(w.trusted,0) AS trusted FROM projects p LEFT JOIN workspaces w ON w.project_id=p.id AND w.kind='primary' ORDER BY p.created_at",
        )
        .all() as Project[]
    ).map((p) => ({ ...p, trusted: Boolean(p.trusted) }));
  }
  project(id: string) {
    const p = this.projects().find((p) => p.id === id);
    if (!p) throw new Error('Project not found.');
    return p;
  }
  addProject(path: string) {
    const existing = this.projects().find((p) => p.path === path);
    if (existing) return existing;
    const project = {
      id: randomUUID(),
      workspaceId: randomUUID(),
      name: basename(path) || path,
      kind: 'folder' as const,
      path,
      trusted: false,
    };
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO projects(id,name,created_at,kind) VALUES (?, ?, ?, ?)')
        .run(project.id, project.name, now(), project.kind);
      this.db
        .prepare('INSERT INTO workspaces(id,project_id,path,trusted) VALUES (?, ?, ?, 0)')
        .run(project.workspaceId, project.id, path);
    })();
    return project;
  }
  trustProject(id: string, trusted: boolean) {
    if (this.project(id).kind !== 'folder')
      throw new Error('Chat projects do not have a directory to trust.');
    this.db.prepare('UPDATE workspaces SET trusted=? WHERE project_id=?').run(+trusted, id);
  }
  removeProject(id: string) {
    this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
  }
  createChatProject(name: string): Project {
    const title = name.trim();
    if (!title || title.length > 80) throw new Error('Project names must contain 1–80 characters.');
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO projects(id,name,created_at,kind) VALUES (?,?,?,'chat')")
      .run(id, title, now());
    return this.project(id);
  }
  renameProject(id: string, name: string) {
    this.project(id);
    const title = name.trim();
    if (!title || title.length > 80) throw new Error('Project names must contain 1–80 characters.');
    this.db.prepare('UPDATE projects SET name=? WHERE id=?').run(title, id);
  }
  workspaces(): Workspace[] {
    return (
      this.db
        .prepare(
          'SELECT id,project_id AS projectId,path,trusted,kind,branch,source_ref AS sourceRef,source_workspace_id AS sourceWorkspaceId,archived FROM workspaces',
        )
        .all() as Workspace[]
    ).map((w) => ({ ...w, trusted: !!w.trusted, archived: !!w.archived }));
  }
  workspace(id: string): Workspace {
    const workspace = this.workspaces().find((w) => w.id === id);
    if (!workspace) throw new Error('Workspace not found.');
    return workspace;
  }
  resolveWorkspace(reference: string): Workspace {
    const workspace = this.workspaces().find(
      (w) => w.id === reference || (w.projectId === reference && w.kind === 'primary'),
    );
    if (!workspace) throw new Error('Workspace not found.');
    return workspace;
  }
  addWorkspace(projectId: string, path: string, branch: string, sourceRef: string): Workspace {
    const project = this.project(projectId);
    if (project.kind !== 'folder' || !project.workspaceId)
      throw new Error('Choose a folder project to create a workspace.');
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO workspaces(id,project_id,path,trusted,kind,branch,source_ref,source_workspace_id) VALUES (?,?,?,?,'worktree',?,?,?)",
      )
      .run(id, projectId, path, +project.trusted, branch, sourceRef, project.workspaceId);
    return this.workspace(id);
  }
  archiveWorkspace(id: string) {
    const w = this.workspace(id);
    if (w.kind === 'primary') throw new Error('The primary project workspace cannot be archived.');
    this.db.prepare('UPDATE workspaces SET archived=1 WHERE id=?').run(id);
  }
  restoreWorkspace(id: string) {
    const w = this.workspace(id);
    this.db.prepare('UPDATE workspaces SET archived=0 WHERE id=?').run(w.id);
  }
  conversations(archived = false) {
    return (
      this.db
        .prepare(convSelect + ' WHERE archived=? ORDER BY pinned DESC, updated_at DESC')
        .all(+archived) as Conversation[]
    ).map((c) => ({ ...c, archived: !!c.archived, pinned: !!c.pinned }));
  }
  conversation(id: string) {
    const c = this.db.prepare(convSelect + ' WHERE id=?').get(id) as Conversation | undefined;
    if (!c) throw new Error('Conversation not found.');
    const previous = this.lastSession(id);
    return {
      ...c,
      archived: !!c.archived,
      pinned: !!c.pinned,
      connectionChanged:
        !!previous && previous.configurationRevision !== this.configurationRevision(c.providerId),
    };
  }
  createConversation(projectId?: string, workspaceId?: string): Conversation {
    const p = projectId ? this.project(projectId) : undefined;
    const w = workspaceId ? this.workspace(workspaceId) : undefined;
    if (w && (!p || w.projectId !== p.id || w.archived))
      throw new Error('Choose an active workspace belonging to this project.');
    const c: Conversation = {
      id: randomUUID(),
      projectId: p?.id ?? null,
      workspaceId: w?.id ?? p?.workspaceId ?? null,
      title: 'New conversation',
      providerId: 'codex',
      model: '',
      mode: 'ask',
      effort: '',
      updatedAt: now(),
      archived: false,
    };
    this.db
      .prepare(
        'INSERT INTO conversations(id, project_id, workspace_id, title, provider_id, model, mode, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
      )
      .run(c.id, c.projectId, c.workspaceId, c.title, c.providerId, c.model, c.mode, c.updatedAt);
    return c;
  }
  archive(id: string) {
    this.conversation(id);
    this.db.prepare('UPDATE conversations SET archived=1 WHERE id=?').run(id);
  }
  restoreConversation(id: string) {
    this.conversation(id);
    this.db.prepare('UPDATE conversations SET archived=0 WHERE id=?').run(id);
  }
  pin(id: string, pinned: boolean) {
    this.conversation(id);
    this.db.prepare('UPDATE conversations SET pinned=? WHERE id=?').run(+pinned, id);
  }
  draft(key: string): Draft | null {
    const row = this.db.prepare('SELECT content FROM drafts WHERE key=?').get(key) as
      { content: string } | undefined;
    return row ? draftSchema.parse(JSON.parse(row.content)) : null;
  }
  saveDraft(key: string, draft: Draft | null) {
    if (!draft) this.db.prepare('DELETE FROM drafts WHERE key=?').run(key);
    else
      this.db
        .prepare(
          'INSERT INTO drafts VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at',
        )
        .run(key, JSON.stringify(draftSchema.parse(draft)), now());
  }
  projectDefaults(id: string): Partial<Draft> {
    this.project(id);
    const row = this.db
      .prepare('SELECT content FROM project_defaults WHERE project_id=?')
      .get(id) as { content: string } | undefined;
    return row ? JSON.parse(row.content) : {};
  }
  saveProjectDefaults(id: string, defaults: Partial<Draft>) {
    this.project(id);
    this.db
      .prepare(
        'INSERT INTO project_defaults VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET content=excluded.content',
      )
      .run(id, JSON.stringify(defaults));
  }
  patchSettings(patch: SettingsPatch): Settings {
    const current = this.settings();
    const next = settingsSchema.parse({
      ...current,
      ...patch,
      appearance: { ...current.appearance, ...patch.appearance },
    });
    this.saveSettings(next);
    return next;
  }
  configurationRevision(id: ProviderId) {
    const {
      configured: _configured,
      enabled: _enabled,
      name: _name,
      ...config
    } = this.connection(id);
    const credential = this.db
      .prepare('SELECT value FROM settings WHERE key=?')
      .get(`credential-revision:${id}`) as { value: string } | undefined;
    return createHash('sha256')
      .update(JSON.stringify(config) + (credential?.value ?? ''))
      .digest('hex');
  }
  credentialChanged(id: ProviderId) {
    this.db
      .prepare(
        'INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(`credential-revision:${id}`, randomUUID());
  }
  rename(id: string, title: string) {
    this.db
      .prepare('UPDATE conversations SET title=?, updated_at=? WHERE id=?')
      .run(title, now(), id);
  }
  connections(): Connection[] {
    return (
      this.db.prepare('SELECT config FROM provider_connections').all() as { config: string }[]
    ).map((r) => {
      const connection: Connection = JSON.parse(r.config);
      return { ...connection, enabled: connection.enabled && isProviderAvailable(connection.id) };
    });
  }
  connection(id: ProviderId) {
    const c = this.connections().find((c) => c.id === id);
    if (!c) throw new Error('Unknown connection.');
    return c;
  }
  saveConnection(c: Connection) {
    this.db
      .prepare('INSERT OR REPLACE INTO provider_connections VALUES (?, ?)')
      .run(c.id, JSON.stringify(c));
  }
  settings(): Settings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='app'").get() as
      { value: string } | undefined;
    return row ? settingsSchema.parse(JSON.parse(row.value)) : structuredClone(defaultSettings);
  }
  saveSettings(settings: Settings) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES ('app', ?)")
      .run(JSON.stringify(settings));
  }
  lastSession(conversationId: string): Session | undefined {
    return this.db
      .prepare(
        'SELECT id, provider_id AS providerId, native_id AS nativeId, model, mode, configuration_revision AS configurationRevision FROM provider_sessions WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1',
      )
      .get(conversationId) as Session | undefined;
  }
  session(
    conversationId: string,
    providerId: ProviderId,
    model: string,
    mode: string,
    configurationRevision = this.configurationRevision(providerId),
    forceFresh = false,
  ): Session {
    const old = this.lastSession(conversationId);
    if (
      !forceFresh &&
      old &&
      old.providerId === providerId &&
      old.model === model &&
      old.mode === mode &&
      old.configurationRevision === configurationRevision
    )
      return old;
    const s: Session = {
      id: randomUUID(),
      providerId,
      nativeId: null,
      model,
      mode,
      configurationRevision,
    };
    this.db
      .prepare(
        'INSERT INTO provider_sessions(id,conversation_id,provider_id,native_id,model,mode,capabilities,created_at,configuration_revision) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)',
      )
      .run(
        s.id,
        conversationId,
        providerId,
        model,
        mode,
        JSON.stringify(capabilities(providerId)),
        now(),
        configurationRevision,
      );
    return s;
  }
  nativeSession(id: string, nativeId: string) {
    this.db.prepare('UPDATE provider_sessions SET native_id=? WHERE id=?').run(nativeId, id);
  }
  turnByRequest(requestId: string): Turn | undefined {
    return this.db
      .prepare(
        'SELECT id, conversation_id AS conversationId, session_id AS sessionId, status, error FROM turns WHERE request_id=?',
      )
      .get(requestId) as Turn | undefined;
  }
  startTurn(
    conversationId: string,
    session: Session,
    requestId: string,
    text: string,
    context = '',
    effort = '',
    attachments: Attachment[] = [],
    contextSources: ContextSnapshot[] = [],
  ) {
    const turn: Turn = {
      id: randomUUID(),
      conversationId,
      sessionId: session.id,
      status: 'starting',
      createdAt: now(),
    };
    const assistantId = randomUUID();
    const userId = randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO turns(id,conversation_id,session_id,request_id,status,error,created_at,ended_at) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL)',
        )
        .run(turn.id, conversationId, session.id, requestId, turn.status, now());
      const insert = this.db.prepare(
        'INSERT INTO messages(id, conversation_id, session_id, turn_id, role, text, status, provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      insert.run(
        userId,
        conversationId,
        session.id,
        turn.id,
        'user',
        text,
        'sent',
        session.providerId,
        now(),
      );
      if (context)
        this.db
          .prepare('INSERT INTO message_blocks VALUES (?, ?, 0, ?, ?)')
          .run(randomUUID(), userId, 'shared-context-v1', JSON.stringify({ text: context }));
      if (attachments.length) {
        this.db
          .prepare('INSERT INTO message_blocks VALUES (?,?,1,?,?)')
          .run(randomUUID(), userId, 'attachments-v1', JSON.stringify(attachments));
        for (const a of attachments)
          if (a.assetId)
            this.db
              .prepare('INSERT OR IGNORE INTO message_assets VALUES (?,?)')
              .run(userId, a.assetId);
      }
      if (contextSources.length) this.storeContextSources(userId, contextSources);
      insert.run(
        assistantId,
        conversationId,
        session.id,
        turn.id,
        'assistant',
        '',
        'streaming',
        session.providerId,
        now(),
      );
      this.db
        .prepare(
          "UPDATE conversations SET provider_id=?, model=?, mode=?, effort=?, updated_at=?, title=CASE WHEN title='New conversation' THEN ? ELSE title END WHERE id=?",
        )
        .run(
          session.providerId,
          session.model,
          session.mode,
          effort,
          now(),
          text.slice(0, 65),
          conversationId,
        );
    })();
    return { turn, assistantId, userId };
  }
  event(
    turn: Turn,
    type: string,
    payload: unknown,
    text?: { id: string; delta: string; itemId?: string; phase?: ResponseBlock['phase'] },
  ) {
    return this.db.transaction(() => {
      if (text) {
        if (text.itemId) {
          const previous = this.db
            .prepare(
              "SELECT id, content FROM message_blocks WHERE message_id=? AND type='assistant-text-v1' AND json_extract(content, '$.id')=?",
            )
            .get(text.id, text.itemId) as { id: string; content: string } | undefined;
          if (previous) {
            const block = JSON.parse(previous.content) as ResponseBlock;
            block.text += text.delta;
            block.phase = text.phase ?? block.phase;
            this.db
              .prepare('UPDATE message_blocks SET content=? WHERE id=?')
              .run(JSON.stringify(block), previous.id);
          } else {
            this.db
              .prepare(
                "INSERT INTO message_blocks(id, message_id, position, type, content) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1)+1 FROM message_blocks WHERE message_id=?), 'assistant-text-v1', ?)",
              )
              .run(
                randomUUID(),
                text.id,
                text.id,
                JSON.stringify({
                  id: text.itemId,
                  phase: text.phase ?? 'answer',
                  text: text.delta,
                }),
              );
          }
          const blocks = this.db
            .prepare(
              "SELECT content FROM message_blocks WHERE message_id=? AND type='assistant-text-v1' ORDER BY position",
            )
            .all(text.id) as { content: string }[];
          const content = blocks
            .map((block) => (JSON.parse(block.content) as ResponseBlock).text)
            .join('\n\n');
          this.db.prepare('UPDATE messages SET text=? WHERE id=?').run(content, text.id);
        } else {
          this.db.prepare('UPDATE messages SET text=text || ? WHERE id=?').run(text.delta, text.id);
        }
      }
      const result = this.db
        .prepare(
          'INSERT INTO events(conversation_id, session_id, turn_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(turn.conversationId, turn.sessionId, turn.id, type, JSON.stringify(payload), now());
      return Number(result.lastInsertRowid);
    })();
  }
  finish(turn: Turn, status: TurnStatus, error?: string, errorInfo?: ErrorInfo) {
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE turns SET status=?, error=?, ended_at=?, error_info=? WHERE id=?')
        .run(status, error ?? null, now(), errorInfo ? JSON.stringify(errorInfo) : null, turn.id);
      this.db
        .prepare("UPDATE messages SET status=? WHERE turn_id=? AND role='assistant'")
        .run(status, turn.id);
      this.db
        .prepare("UPDATE interactions SET status='cancelled' WHERE turn_id=? AND status='pending'")
        .run(turn.id);
      this.db
        .prepare('UPDATE conversations SET updated_at=? WHERE id=?')
        .run(now(), turn.conversationId);
      this.event(turn, 'status', { status, error });
    })();
  }
  interaction(i: Interaction) {
    this.db
      .prepare('INSERT INTO interactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .run(
        i.id,
        i.conversationId,
        i.sessionId,
        i.turnId,
        i.kind,
        i.title,
        i.detail,
        i.questions ? JSON.stringify(i.questions) : null,
        i.status,
      );
  }
  resolveInteraction(id: string, response: unknown) {
    const result = this.db
      .prepare(
        "UPDATE interactions SET status='resolved', response=? WHERE id=? AND status='pending'",
      )
      .run(JSON.stringify(response), id);
    if (!result.changes) throw new Error('This request is no longer pending.');
  }
  cancelInteraction(id: string) {
    this.db
      .prepare("UPDATE interactions SET status='cancelled' WHERE id=? AND status='pending'")
      .run(id);
  }
  transcript(sessionId: string): Message[] {
    const messages = this.db
      .prepare(msgSelect + " WHERE session_id=? AND status <> 'streaming' ORDER BY seq")
      .all(sessionId) as Message[];
    return this.hydrateMessages(messages);
  }
  cursor(id: string): number {
    return (
      this.db
        .prepare('SELECT COALESCE(MAX(seq),0) AS cursor FROM events WHERE conversation_id=?')
        .get(id) as { cursor: number }
    ).cursor;
  }
  messages(id: string): Message[] {
    this.conversation(id);
    return this.hydrateMessages(
      this.db.prepare(msgSelect + ' WHERE conversation_id=? ORDER BY seq').all(id) as Message[],
    );
  }
  private hydrateMessages(messages: Message[]): Message[] {
    const byId = new Map(messages.map((message) => [message.id, message]));
    const errors = new Map<string, { error: string | null; info: string | null }>();
    for (const message of messages) message.artifactReferences = [];
    for (let offset = 0; offset < messages.length; offset += 500) {
      const chunk = messages.slice(offset, offset + 500);
      const ids = chunk.map((message) => message.id);
      const placeholders = ids.map(() => '?').join(',');
      const blocks = this.db
        .prepare(
          `SELECT message_id AS messageId,type,content FROM message_blocks WHERE message_id IN (${placeholders}) ORDER BY message_id,position`,
        )
        .all(...ids) as { messageId: string; type: string; content: string }[];
      for (const block of blocks) {
        const message = byId.get(block.messageId)!;
        const data = JSON.parse(block.content);
        if (block.type === 'shared-context-v1') message.context = data.text;
        if (block.type === 'assistant-text-v1') (message.blocks ??= []).push(data);
        if (block.type === 'attachments-v1') message.attachments = data;
        if (block.type === 'context-sources-v1')
          message.contextSources = data.map((source: unknown) =>
            contextSnapshotSchema.parse(source),
          );
        if (block.type === 'source-citations-v1')
          message.sourceCitations = sourceCitationAuditSchema.parse(data);
      }
      const references = this.db
        .prepare(
          `SELECT ma.message_id AS messageId,ma.artifact_id AS artifactId,ma.revision_id AS revisionId,ma.relation,a.title,r.number FROM message_artifacts ma JOIN artifacts a ON a.id=ma.artifact_id JOIN artifact_revisions r ON r.id=ma.revision_id WHERE ma.message_id IN (${placeholders})`,
        )
        .all(...ids) as (ArtifactReference & {
        messageId: string;
        relation: string;
        title: string;
        number: number;
      })[];
      for (const { messageId, ...reference } of references)
        byId.get(messageId)!.artifactReferences!.push(reference);
      const turnIds = [
        ...new Set(
          chunk.filter((message) => message.role === 'assistant').map((message) => message.turnId),
        ),
      ];
      if (turnIds.length)
        for (const row of this.db
          .prepare(
            `SELECT id,error,error_info AS info FROM turns WHERE id IN (${turnIds.map(() => '?').join(',')}) AND (error IS NOT NULL OR error_info IS NOT NULL)`,
          )
          .all(...turnIds) as { id: string; error: string | null; info: string | null }[])
          errors.set(row.id, row);
    }
    for (const message of messages) {
      if (message.role === 'assistant') {
        const failed = errors.get(message.turnId);
        if (failed?.info) message.errorInfo = JSON.parse(failed.info);
        else if (failed?.error)
          message.errorInfo = {
            code: message.status === 'interrupted' ? 'interrupted' : 'unknown',
            message: failed.error,
            retryable: true,
            action: 'Review the partial response before resending.',
          };
      }
    }
    return messages;
  }
  view(id: string, before?: string, around?: string): ConversationView {
    const conversation = this.conversation(id);
    let messages = this.db
      .prepare(
        msgSelect +
          ' WHERE conversation_id=? AND seq < COALESCE((SELECT seq FROM messages WHERE id=? AND conversation_id=?), 9223372036854775807) ORDER BY seq DESC LIMIT 101',
      )
      .all(id, before ?? '', id) as Message[];
    let hasMore = messages.length > 100;
    if (hasMore) messages.pop();
    messages.reverse();
    if (around) {
      const target = this.db
        .prepare('SELECT seq FROM messages WHERE id=? AND conversation_id=?')
        .get(around, id) as { seq: number } | undefined;
      if (!target) throw new Error('Message not found in this conversation.');
      messages = this.db
        .prepare(msgSelect + ' WHERE conversation_id=? AND seq>=? ORDER BY seq LIMIT 100')
        .all(id, target.seq) as Message[];
      hasMore = !!this.db
        .prepare('SELECT 1 FROM messages WHERE conversation_id=? AND seq<? LIMIT 1')
        .get(id, target.seq);
    }
    this.hydrateMessages(messages);
    const interactions = (
      this.db
        .prepare(
          "SELECT id, conversation_id AS conversationId, session_id AS sessionId, turn_id AS turnId, kind, title, detail, questions, status FROM interactions WHERE conversation_id=? AND status='pending'",
        )
        .all(id) as (Omit<Interaction, 'questions'> & { questions: string | null })[]
    ).map((i) => ({ ...i, questions: i.questions ? JSON.parse(i.questions) : undefined }));
    const cursor = this.cursor(id);
    const turnIds = [...new Set(messages.map((message) => message.turnId))];
    const placeholders = turnIds.map(() => '?').join(',');
    const events = turnIds.length
      ? (this.db
          .prepare(
            `SELECT seq, turn_id AS turnId, type, payload FROM events WHERE conversation_id=? AND turn_id IN (${placeholders}) AND type IN ('tool', 'warning') ORDER BY seq`,
          )
          .all(id, ...turnIds) as { seq: number; turnId: string; type: string; payload: string }[])
      : [];
    const tools = new Map<string, ConversationActivity>();
    for (const e of events) {
      const data = JSON.parse(e.payload);
      if (e.type === 'tool') tools.set(`${e.turnId}:${data.id}`, { ...data, turnId: e.turnId });
      if (e.type === 'warning')
        tools.set(`warning-${e.seq}`, {
          id: `warning-${e.seq}`,
          turnId: e.turnId,
          title: 'Provider notice',
          detail: data.message,
          status: 'failed',
        });
    }
    const failedTurns = turnIds.length
      ? (this.db
          .prepare(
            `SELECT id, error FROM turns WHERE conversation_id=? AND id IN (${placeholders}) AND error IS NOT NULL`,
          )
          .all(id, ...turnIds) as { id: string; error: string }[])
      : [];
    for (const failed of failedTurns)
      tools.set(`error:${failed.id}`, {
        id: `error:${failed.id}`,
        turnId: failed.id,
        title: 'Turn interrupted',
        detail: failed.error,
        status: 'failed',
      });
    const rawUsage = this.db
      .prepare(
        "SELECT payload,created_at AS checkedAt FROM events WHERE conversation_id=? AND type='usage' ORDER BY seq DESC LIMIT 1",
      )
      .get(id) as { payload: string; checkedAt: string } | undefined;
    let usage: ConversationView['usage'];
    if (rawUsage) {
      const data = JSON.parse(rawUsage.payload).data ?? {};
      const tokens = data.last ?? data.total ?? data;
      const input = tokens.input_tokens ?? tokens.inputTokens;
      const output = tokens.output_tokens ?? tokens.outputTokens;
      const total = tokens.total_tokens ?? tokens.totalTokens;
      if (
        [input, output, total].some((value) => typeof value === 'number' && Number.isFinite(value))
      )
        usage = {
          inputTokens: typeof input === 'number' ? input : undefined,
          outputTokens: typeof output === 'number' ? output : undefined,
          totalTokens: typeof total === 'number' ? total : undefined,
          checkedAt: rawUsage.checkedAt,
        };
    }
    return {
      conversation,
      messages,
      interactions,
      tools: [...tools.values()],
      cursor,
      hasMore,
      usage,
      currentSessionId: this.lastSession(id)?.id,
    };
  }
  search(
    query: string,
    filters: {
      projectId?: string;
      providerId?: ProviderId;
      archived?: boolean;
      conversationId?: string;
    } = {},
  ): SearchResult[] {
    const terms = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replace(/"/g, '""')}"*`)
      .join(' AND ');
    if (!terms) return [];
    const scope =
      ' AND (?=1 OR c.archived=0) AND (? IS NULL OR c.project_id=?) AND (? IS NULL OR c.provider_id=?) AND (? IS NULL OR c.id=?)';
    const params = [
      +!!filters.archived,
      filters.projectId ?? null,
      filters.projectId ?? null,
      filters.providerId ?? null,
      filters.providerId ?? null,
      filters.conversationId ?? null,
      filters.conversationId ?? null,
    ];
    const messages = this.db
      .prepare(
        `SELECT c.id AS conversationId,c.title,m.id AS messageId,snippet(message_search,0,'','',' … ',32) AS snippet,m.provider_id AS providerId,c.project_id AS projectId,c.archived,m.created_at AS createdAt FROM message_search JOIN messages m ON m.seq=message_search.rowid JOIN conversations c ON c.id=m.conversation_id WHERE message_search MATCH ?${scope.replace('c.provider_id', 'm.provider_id')} ORDER BY m.seq DESC LIMIT 80`,
      )
      .all(terms, ...params) as SearchResult[];
    const titles = this.db
      .prepare(
        `SELECT c.id AS conversationId,c.title,NULL AS messageId,c.title AS snippet,c.provider_id AS providerId,c.project_id AS projectId,c.archived,c.updated_at AS createdAt FROM title_search JOIN conversations c ON c.rowid=title_search.rowid WHERE title_search MATCH ?${scope} ORDER BY c.updated_at DESC LIMIT 20`,
      )
      .all(terms, ...params) as SearchResult[];
    return [
      ...titles.filter((t) => !messages.some((m) => m.conversationId === t.conversationId)),
      ...messages,
    ].map((r) => ({ ...r, archived: !!r.archived }));
  }
  branch(id: string, messageId: string, edit = false): Conversation {
    const source = this.conversation(id);
    const messages = this.messages(id);
    const index = messages.findIndex((m) => m.id === messageId);
    if (index < 0) throw new Error('Message not found in this conversation.');
    const selected = messages[index];
    if (
      selected.role === 'assistant' &&
      !['completed', 'failed', 'cancelled', 'interrupted'].includes(selected.status)
    )
      throw new Error('Wait until this response completes before branching.');
    if (edit && selected.role !== 'user') throw new Error('Choose a user message to edit.');
    return this.db.transaction(() => {
      const sourceDraft = this.draft(id);
      const c = this.createConversation(
        source.projectId ?? undefined,
        source.workspaceId ?? undefined,
      );
      const mode = source.mode === 'code-bypass' ? 'code' : source.mode;
      this.db
        .prepare(
          'UPDATE conversations SET title=?,provider_id=?,model=?,mode=?,effort=?,parent_conversation_id=?,parent_message_id=? WHERE id=?',
        )
        .run(
          `${source.title.slice(0, 125)} · branch`,
          source.providerId,
          source.model,
          mode,
          source.effort,
          id,
          messageId,
          c.id,
        );
      new OrganizationService(this.db).copyTags(id, c.id);
      const session = this.session(c.id, source.providerId, source.model, mode);
      const turns = new Map<string, string>();
      const messageIds = new Map<string, string>();
      for (const m of messages.slice(0, index + (edit ? 0 : 1))) {
        let turnId = turns.get(m.turnId);
        if (!turnId) {
          turnId = randomUUID();
          turns.set(m.turnId, turnId);
          const originalTurn = this.db
            .prepare(
              'SELECT status,error,error_info AS errorInfo,created_at AS createdAt,ended_at AS endedAt FROM turns WHERE id=?',
            )
            .get(m.turnId) as {
            status: TurnStatus;
            error: string | null;
            errorInfo: string | null;
            createdAt: string;
            endedAt: string | null;
          };
          if (['starting', 'running', 'waiting'].includes(originalTurn.status))
            throw new Error('Stop the active turn before branching.');
          this.db
            .prepare(
              'INSERT INTO turns(id,conversation_id,session_id,request_id,status,error,error_info,created_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?)',
            )
            .run(
              turnId,
              c.id,
              session.id,
              randomUUID(),
              originalTurn.status,
              originalTurn.error,
              originalTurn.errorInfo,
              originalTurn.createdAt,
              originalTurn.endedAt,
            );
        }
        const newId = randomUUID();
        messageIds.set(m.id, newId);
        this.db
          .prepare(
            'INSERT INTO messages(id,conversation_id,session_id,turn_id,role,text,status,provider_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .run(
            newId,
            c.id,
            session.id,
            turnId,
            m.role,
            m.text,
            m.status,
            m.providerId,
            m.createdAt,
          );
        for (const block of this.db
          .prepare(
            'SELECT position,type,content FROM message_blocks WHERE message_id=? ORDER BY position',
          )
          .all(m.id) as { position: number; type: string; content: string }[])
          this.db
            .prepare('INSERT INTO message_blocks VALUES (?,?,?,?,?)')
            .run(randomUUID(), newId, block.position, block.type, block.content);
        for (const a of m.attachments ?? [])
          if (a.assetId)
            this.db
              .prepare('INSERT OR IGNORE INTO message_assets VALUES (?,?)')
              .run(newId, a.assetId);
        for (const source of m.contextSources ?? [])
          if (source.source?.assetId)
            this.db
              .prepare('INSERT OR IGNORE INTO message_assets VALUES (?,?)')
              .run(newId, source.source.assetId);
        copyArtifactReferences(this.db, m.id, newId);
      }
      const branchSources = [
        ...new Map([
          ...messages
            .slice(0, index + 1)
            .flatMap((message) =>
              (message.contextSources ?? []).filter((snapshot) => snapshot.kind === 'instructions'),
            )
            .map((snapshot) => [snapshot.itemId ?? snapshot.id, snapshot] as const),
          ...(edit ? (selected.contextSources ?? []) : []).map(
            (snapshot) => [snapshot.itemId ?? snapshot.id, snapshot] as const,
          ),
        ]).values(),
      ];
      const snapshotIds = new Map<string, string>();
      const contextRefs = branchSources.map((snapshot) => {
        if (snapshot.projectId && snapshot.projectId !== c.projectId) {
          const copied = {
            ...snapshot,
            id: randomUUID(),
            itemId: null,
            projectId: c.projectId,
            createdAt: now(),
          };
          this.storeSnapshot(copied);
          snapshotIds.set(snapshot.id, copied.id);
          return { snapshotId: copied.id, included: true, reviewed: true };
        }
        return { snapshotId: snapshot.id, included: true, reviewed: true };
      });
      const availableSourceIds = new Set([
        ...messages
          .slice(0, index + (edit ? 0 : 1))
          .flatMap((message) => (message.contextSources ?? []).map((snapshot) => snapshot.id)),
        ...contextRefs.map((ref) => ref.snapshotId),
      ]);
      this.saveDraft(c.id, {
        text: edit ? selected.text : '',
        attachments: edit ? (selected.attachments ?? []) : [],
        provider: source.providerId,
        model: source.model,
        mode,
        effort: source.effort,
        contextRefs,
        historyMessageIds: sourceDraft?.historyMessageIds?.flatMap((id) => {
          const mapped = messageIds.get(id);
          return mapped ? [mapped] : [];
        }),
        excludedContextSnapshotIds: sourceDraft?.excludedContextSnapshotIds
          ?.map((id) => snapshotIds.get(id) ?? id)
          .filter((id) => availableSourceIds.has(id)),
      });
      return this.conversation(c.id);
    })();
  }
  exportData(id: string) {
    const conversation = this.conversation(id);
    const messages = this.messages(id);
    let draft = this.draft(id) ?? undefined;
    const artifacts = exportConversationArtifacts(this.db, id, draft?.artifactReferences ?? []);
    const sharedSnapshotIds = new Set(
      messages.flatMap((message) => (message.contextSources ?? []).map((source) => source.id)),
    );
    const contextSnapshots = [
      ...new Map(
        [
          ...(draft?.contextRefs ?? [])
            .filter((ref) => !sharedSnapshotIds.has(ref.snapshotId))
            .map((ref) => {
              const row = this.db
                .prepare('SELECT content FROM context_snapshots WHERE id=?')
                .get(ref.snapshotId) as { content: string } | undefined;
              if (!row) throw new Error('An unsent source snapshot is unavailable.');
              return contextSnapshotSchema.parse(JSON.parse(row.content));
            }),
        ].map((snapshot) => [snapshot.id, snapshot]),
      ).values(),
    ];
    if (draft) {
      const declaredSourceIds = new Set([
        ...sharedSnapshotIds,
        ...contextSnapshots.map((snapshot) => snapshot.id),
      ]);
      draft = {
        ...draft,
        excludedContextSnapshotIds: draft.excludedContextSnapshotIds?.filter((snapshotId) =>
          declaredSourceIds.has(snapshotId),
        ),
      };
    }
    const ids = new Set(
      messages.flatMap((m) => m.attachments?.flatMap((a) => (a.assetId ? [a.assetId] : [])) ?? []),
    );
    for (const source of messages.flatMap((message) => message.contextSources ?? []))
      if (source.source?.assetId) ids.add(source.source.assetId);
    for (const source of contextSnapshots)
      if (source.source?.assetId) ids.add(source.source.assetId);
    for (const attachment of draft?.attachments ?? [])
      if (attachment.assetId) ids.add(attachment.assetId);
    for (const artifact of artifacts)
      for (const revision of artifact.revisions)
        for (const assetId of revision.assetIds) ids.add(assetId);
    return {
      format: 'multiclient-conversation',
      version: 2,
      conversation: { ...conversation, tagNames: new OrganizationService(this.db).exportTags(id) },
      messages,
      artifacts,
      draft,
      contextSnapshots,
      assets: [...ids].map((assetId) => {
        const asset = this.asset(assetId);
        if (!asset) throw new Error('A referenced attachment asset is unavailable.');
        return asset;
      }),
    };
  }
  importData(
    data: {
      conversation: {
        title: string;
        providerId: ProviderId;
        model: string;
        mode: string;
        effort?: string;
        tagNames?: string[];
      };
      messages: Message[];
      artifacts?: ExportedArtifact[];
      draft?: Draft;
      contextSnapshots?: ContextSnapshot[];
    },
    assets: { id: string; mime: string; type: string; size: number; hash: string }[] = [],
  ): Conversation {
    return this.db.transaction(() => {
      for (const asset of assets) this.registerAsset(asset);
      data = {
        ...data,
        contextSnapshots: data.contextSnapshots?.map((snapshot) => ({
          ...snapshot,
          itemId: null,
          projectId: null,
        })),
        messages: data.messages.map((message) => ({
          ...message,
          contextSources: message.contextSources?.map((snapshot) => ({
            ...snapshot,
            itemId: null,
            projectId: null,
          })),
        })),
      };
      for (const snapshot of data.contextSnapshots ?? []) this.storeSnapshot(snapshot);
      const c = this.createConversation();
      new OrganizationService(this.db).importTags(c.id, data.conversation.tagNames ?? []);
      const source = data.conversation;
      const mode = ['ask', 'chat'].includes(source.mode) ? source.mode : 'ask';
      this.db
        .prepare(
          'UPDATE conversations SET title=?,provider_id=?,model=?,mode=?,effort=? WHERE id=?',
        )
        .run(source.title, source.providerId, source.model, mode, source.effort ?? '', c.id);
      const session = this.session(c.id, source.providerId, source.model, mode);
      const messageIdMap = new Map<string, string>();
      const declaredContextIds = new Set([
        ...data.messages.flatMap((message) =>
          (message.contextSources ?? []).map((source) => source.id),
        ),
        ...(data.contextSnapshots ?? []).map((snapshot) => snapshot.id),
      ]);
      for (const message of data.messages) {
        const turnId = randomUUID();
        const messageId = randomUUID();
        if (message.id) messageIdMap.set(message.id, messageId);
        const status = ['failed', 'cancelled', 'interrupted'].includes(message.status)
          ? message.status
          : message.status === 'streaming'
            ? 'interrupted'
            : 'completed';
        this.db
          .prepare(
            'INSERT INTO turns(id,conversation_id,session_id,request_id,status,created_at,ended_at,error,error_info) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .run(
            turnId,
            c.id,
            session.id,
            randomUUID(),
            status,
            message.createdAt,
            message.createdAt,
            message.errorInfo?.message ?? null,
            message.errorInfo ? JSON.stringify(message.errorInfo) : null,
          );
        this.db
          .prepare(
            'INSERT INTO messages(id,conversation_id,session_id,turn_id,role,text,status,provider_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .run(
            messageId,
            c.id,
            session.id,
            turnId,
            message.role,
            message.text,
            message.role === 'user' ? 'sent' : status,
            message.providerId,
            message.createdAt,
          );
        if (message.context)
          this.db
            .prepare('INSERT INTO message_blocks VALUES (?,?,0,?,?)')
            .run(
              randomUUID(),
              messageId,
              'shared-context-v1',
              JSON.stringify({ text: message.context }),
            );
        if (message.attachments?.length) {
          this.db
            .prepare('INSERT INTO message_blocks VALUES (?,?,1,?,?)')
            .run(randomUUID(), messageId, 'attachments-v1', JSON.stringify(message.attachments));
          for (const a of message.attachments)
            if (a.assetId)
              this.db.prepare('INSERT INTO message_assets VALUES (?,?)').run(messageId, a.assetId);
        }
        if (message.contextSources?.length)
          this.storeContextSources(messageId, message.contextSources);
        if (message.sourceCitations) {
          const audit = sourceCitationAuditSchema.parse(message.sourceCitations);
          for (const snapshotId of audit.sources)
            if (
              !declaredContextIds.has(snapshotId) ||
              !this.db.prepare('SELECT id FROM context_snapshots WHERE id=?').get(snapshotId)
            )
              throw new Error('A citation source is missing from the imported conversation.');
          if (audit.valid.some((citation) => !audit.sources.includes(citation.snapshotId)))
            throw new Error('A citation refers to a source outside its submitted manifest.');
          this.db
            .prepare('INSERT INTO message_blocks VALUES (?,?,?, ?,?)')
            .run(randomUUID(), messageId, 3, 'source-citations-v1', JSON.stringify(audit));
        }
        for (const [position, block] of (message.blocks ?? []).entries())
          this.db
            .prepare('INSERT INTO message_blocks VALUES (?,?,?,?,?)')
            .run(randomUUID(), messageId, position + 4, 'assistant-text-v1', JSON.stringify(block));
      }
      const artifactMap = data.artifacts?.length
        ? importConversationArtifacts(this.db, data.artifacts, messageIdMap, c.projectId)
        : new Map();
      if (data.draft) {
        const draft = draftSchema.parse(data.draft);
        for (const ref of draft.contextRefs ?? [])
          if (!declaredContextIds.has(ref.snapshotId))
            throw new Error('An unsent source is missing from the export.');
        if (draft.excludedContextSnapshotIds?.some((id) => !declaredContextIds.has(id)))
          throw new Error('An excluded source is missing from the export.');
        const refs = draft.artifactReferences?.map((ref) => {
          const artifact = artifactMap.get(ref.artifactId);
          const revisionId = artifact?.revisions.get(ref.revisionId);
          if (!artifact || !revisionId)
            throw new Error('An unsent artifact revision is missing from the export.');
          return { artifactId: artifact.id as string, revisionId: revisionId as string };
        });
        const historyMessageIds = draft.historyMessageIds?.map((id) => {
          const mapped = messageIdMap.get(id);
          if (!mapped) throw new Error('A selected history message is missing from the export.');
          return mapped;
        });
        this.saveDraft(c.id, {
          ...draft,
          mode: draft.mode === 'code-bypass' ? 'code' : draft.mode,
          artifactReferences: refs,
          historyMessageIds,
        });
      }
      return this.conversation(c.id);
    })();
  }
  private storeContextSources(messageId: string, raw: ContextSnapshot[]) {
    const sources = raw.map((source) => contextSnapshotSchema.parse(source));
    for (const source of sources)
      if (
        source.source?.web &&
        createHash('sha256').update(source.text).digest('hex') !== source.source.web.hash
      )
        throw new Error('An imported web source does not match its captured hash.');
    this.db
      .prepare('INSERT INTO message_blocks VALUES (?,?,2,?,?)')
      .run(randomUUID(), messageId, 'context-sources-v1', JSON.stringify(sources));
    for (const source of sources) {
      this.storeSnapshot(source);
      if (source.source?.assetId)
        this.db
          .prepare('INSERT OR IGNORE INTO message_assets VALUES (?,?)')
          .run(messageId, source.source.assetId);
    }
  }
  private storeSnapshot(raw: ContextSnapshot) {
    const source = contextSnapshotSchema.parse(raw);
    if (
      source.source?.web &&
      createHash('sha256').update(source.text).digest('hex') !== source.source.web.hash
    )
      throw new Error('An imported web source does not match its captured hash.');
    if (source.source?.assetId && !this.asset(source.source.assetId))
      throw new Error('A source snapshot asset is missing.');
    const existing = this.db
      .prepare('SELECT content FROM context_snapshots WHERE id=?')
      .get(source.id) as { content: string } | undefined;
    if (existing && existing.content !== JSON.stringify(source))
      throw new Error('A source snapshot ID cannot identify different content.');
    this.db
      .prepare('INSERT OR IGNORE INTO context_snapshots VALUES (?,?)')
      .run(source.id, JSON.stringify(source));
  }
  async backup(path: string) {
    await this.db.backup(path);
    const snapshot = new Database(path, { readonly: true, fileMustExist: true });
    try {
      return snapshot.prepare('SELECT id,mime,type,size,hash FROM assets').all();
    } finally {
      snapshot.close();
    }
  }
  registerAsset(a: { id: string; mime: string; type: string; size: number; hash: string }) {
    this.db
      .prepare('INSERT INTO assets VALUES (?, ?, ?, ?, ?)')
      .run(a.id, a.mime, a.type, a.size, a.hash);
  }
  asset(id: string) {
    return this.db.prepare('SELECT * FROM assets WHERE id=?').get(id) as
      { id: string; mime: string; type: string; size: number; hash: string } | undefined;
  }
}

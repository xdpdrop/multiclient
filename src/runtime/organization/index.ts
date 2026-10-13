import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  organizationRoutes,
  promptTemplateInputSchema,
  tagNameSchema,
  tagNamesSchema,
  type ConversationTag,
  type PromptTemplate,
  type PromptTemplateInput,
} from '../../shared/organization';
import type { ProviderId, SearchResult } from '../../shared/types';

export type OrganizationSearchFilters = {
  projectId?: string;
  providerId?: ProviderId;
  conversationId?: string;
  archived?: boolean;
  tagIds?: string[];
};
const templateSelect =
  'SELECT id,name,body,project_id AS projectId,revision,updated_at AS updatedAt FROM prompt_templates';
const normalizedName = (name: string) => name.normalize('NFKC').toLowerCase();

export class OrganizationService {
  constructor(private readonly db: Database.Database) {}

  tags(): ConversationTag[] {
    return this.db
      .prepare('SELECT id,name FROM tags ORDER BY normalized_name,id')
      .all() as ConversationTag[];
  }

  createTag(name: string): ConversationTag {
    name = tagNameSchema.parse(name);
    const normalized = normalizedName(name);
    const existing = this.db
      .prepare('SELECT id,name FROM tags WHERE normalized_name=?')
      .get(normalized) as ConversationTag | undefined;
    if (existing) return existing;
    const tag = { id: randomUUID(), name };
    this.db.prepare('INSERT INTO tags VALUES (?,?,?)').run(tag.id, name, normalized);
    return tag;
  }

  renameTag(id: string, name: string): ConversationTag {
    name = tagNameSchema.parse(name);
    const existing = this.db
      .prepare('SELECT id FROM tags WHERE normalized_name=? AND id<>?')
      .get(normalizedName(name), id);
    if (existing) throw new Error('A tag with this name already exists.');
    if (
      !this.db
        .prepare('UPDATE tags SET name=?,normalized_name=? WHERE id=?')
        .run(name, normalizedName(name), id).changes
    )
      throw new Error('Tag not found.');
    return { id, name };
  }

  deleteTag(id: string) {
    this.db.prepare('DELETE FROM tags WHERE id=?').run(id);
  }

  conversationTags(conversationId: string): ConversationTag[] {
    return this.db
      .prepare(
        'SELECT t.id,t.name FROM tags t JOIN conversation_tags ct ON ct.tag_id=t.id WHERE ct.conversation_id=? ORDER BY t.normalized_name,t.id',
      )
      .all(conversationId) as ConversationTag[];
  }

  setConversationTags(conversationId: string, tagIds: string[]) {
    const input = organizationRoutes.setConversationTags.parse({ conversationId, tagIds });
    this.db.transaction(() => {
      if (!this.db.prepare('SELECT id FROM conversations WHERE id=?').get(input.conversationId))
        throw new Error('Conversation not found.');
      const unique = [...new Set(input.tagIds)];
      for (const id of unique)
        if (!this.db.prepare('SELECT id FROM tags WHERE id=?').get(id))
          throw new Error('Tag not found.');
      this.db
        .prepare('DELETE FROM conversation_tags WHERE conversation_id=?')
        .run(input.conversationId);
      const insert = this.db.prepare('INSERT INTO conversation_tags VALUES (?,?)');
      for (const id of unique) insert.run(input.conversationId, id);
    })();
  }

  enrich<T extends { id: string }>(conversations: T[]): (T & { tags: ConversationTag[] })[] {
    const found = new Map<string, ConversationTag[]>();
    for (let offset = 0; offset < conversations.length; offset += 500) {
      const ids = conversations.slice(offset, offset + 500).map((c) => c.id);
      const rows = this.db
        .prepare(
          `SELECT ct.conversation_id AS conversationId,t.id,t.name FROM conversation_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.conversation_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.normalized_name,t.id`,
        )
        .all(...ids) as (ConversationTag & { conversationId: string })[];
      for (const row of rows) {
        const tags = found.get(row.conversationId) ?? [];
        tags.push({ id: row.id, name: row.name });
        found.set(row.conversationId, tags);
      }
    }
    return conversations.map((c) => ({ ...c, tags: found.get(c.id) ?? [] }));
  }

  copyTags(sourceId: string, destinationId: string) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO conversation_tags SELECT ?,tag_id FROM conversation_tags WHERE conversation_id=?',
      )
      .run(destinationId, sourceId);
  }

  exportTags(id: string): string[] {
    return this.conversationTags(id).map((tag) => tag.name);
  }

  importTags(id: string, names: string[]) {
    names = tagNamesSchema.parse(names);
    this.db.transaction(() => {
      this.setConversationTags(
        id,
        names.map((name) => this.createTag(name).id),
      );
    })();
  }

  promptTemplates(projectId?: string): PromptTemplate[] {
    return this.db
      .prepare(
        `${templateSelect} WHERE project_id IS NULL OR project_id=? ORDER BY name COLLATE NOCASE,id`,
      )
      .all(projectId ?? null) as PromptTemplate[];
  }

  savePromptTemplate(raw: PromptTemplateInput): PromptTemplate {
    const input = promptTemplateInputSchema.parse(raw);
    const projectId = input.projectId ?? null;
    if (projectId && !this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))
      throw new Error('Project not found.');
    const id = input.id ?? randomUUID();
    const updatedAt = new Date().toISOString();
    if (input.id) {
      const result = this.db
        .prepare(
          'UPDATE prompt_templates SET name=?,body=?,project_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
        )
        .run(input.name, input.body, projectId, updatedAt, id, input.revision!);
      if (!result.changes)
        throw new Error('This template changed or was deleted. Reopen it before saving.');
    } else {
      this.db
        .prepare('INSERT INTO prompt_templates VALUES (?,?,?,?,1,?)')
        .run(id, input.name, input.body, projectId, updatedAt);
    }
    return this.db.prepare(`${templateSelect} WHERE id=?`).get(id) as PromptTemplate;
  }

  deletePromptTemplate(id: string, revision: number) {
    if (
      !this.db.prepare('DELETE FROM prompt_templates WHERE id=? AND revision=?').run(id, revision)
        .changes
    )
      throw new Error('This template changed or was deleted. Reopen it before deleting.');
  }

  search(query: string, filters: OrganizationSearchFilters = {}): SearchResult[] {
    const tags = [...new Set(filters.tagIds ?? [])];
    const scope =
      ' AND (?=1 OR c.archived=0) AND (? IS NULL OR c.project_id=?) AND (? IS NULL OR c.provider_id=?) AND (? IS NULL OR c.id=?)' +
      (tags.length
        ? ` AND c.id IN (SELECT conversation_id FROM conversation_tags WHERE tag_id IN (${tags.map(() => '?').join(',')}) GROUP BY conversation_id HAVING COUNT(DISTINCT tag_id)=?)`
        : '');
    const params = [
      +!!filters.archived,
      filters.projectId ?? null,
      filters.projectId ?? null,
      filters.providerId ?? null,
      filters.providerId ?? null,
      filters.conversationId ?? null,
      filters.conversationId ?? null,
      ...tags,
      ...(tags.length ? [tags.length] : []),
    ];
    const terms = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replace(/"/g, '""')}"*`)
      .join(' AND ');
    const columns =
      'c.id AS conversationId,c.title,NULL AS messageId,c.title AS snippet,c.provider_id AS providerId,c.project_id AS projectId,c.archived,c.updated_at AS createdAt';
    if (!terms)
      return (
        this.db
          .prepare(
            `SELECT ${columns} FROM conversations c WHERE 1=1${scope} ORDER BY c.updated_at DESC LIMIT 100`,
          )
          .all(...params) as SearchResult[]
      ).map((r) => ({ ...r, archived: !!r.archived }));
    const messages = this.db
      .prepare(
        `SELECT c.id AS conversationId,c.title,m.id AS messageId,snippet(message_search,0,'','',' … ',32) AS snippet,m.provider_id AS providerId,c.project_id AS projectId,c.archived,m.created_at AS createdAt FROM message_search JOIN messages m ON m.seq=message_search.rowid JOIN conversations c ON c.id=m.conversation_id WHERE message_search MATCH ?${scope.replace('c.provider_id', 'm.provider_id')} ORDER BY m.seq DESC LIMIT 80`,
      )
      .all(terms, ...params) as SearchResult[];
    const titles = this.db
      .prepare(
        `SELECT ${columns} FROM title_search JOIN conversations c ON c.rowid=title_search.rowid WHERE title_search MATCH ?${scope} ORDER BY c.updated_at DESC LIMIT 20`,
      )
      .all(terms, ...params) as SearchResult[];
    return [
      ...titles.filter((t) => !messages.some((m) => m.conversationId === t.conversationId)),
      ...messages,
    ].map((r) => ({ ...r, archived: !!r.archived }));
  }

  dispatch(route: keyof typeof organizationRoutes, raw: unknown) {
    const input: any = organizationRoutes[route].parse(raw);
    switch (route) {
      case 'tags':
        return this.tags();
      case 'createTag':
        return this.createTag(input.name);
      case 'renameTag':
        return this.renameTag(input.id, input.name);
      case 'deleteTag':
        return this.deleteTag(input.id);
      case 'conversationTags':
        return this.conversationTags(input.conversationId);
      case 'setConversationTags':
        return this.setConversationTags(input.conversationId, input.tagIds);
      case 'promptTemplates':
        return this.promptTemplates(input.projectId);
      case 'savePromptTemplate':
        return this.savePromptTemplate(input);
      case 'deletePromptTemplate':
        return this.deletePromptTemplate(input.id, input.revision);
    }
  }
}

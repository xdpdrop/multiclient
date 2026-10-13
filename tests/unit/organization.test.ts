import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { OrganizationService } from '../../src/runtime/organization';
import { organizationRoutes, promptTemplateInputSchema } from '../../src/shared/organization';
import {
  applyTemplatePreview,
  templatePreviewText,
} from '../../src/renderer/features/template-application';

let db: DatabaseSync;
let organization: OrganizationService;
function adapter(database: DatabaseSync): Database.Database {
  let counter = 0;
  return {
    prepare: (sql: string) => database.prepare(sql),
    transaction:
      (operation: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) => {
        const name = `organization_test_${++counter}`;
        database.exec(`SAVEPOINT ${name}`);
        try {
          const result = operation(...args);
          database.exec(`RELEASE ${name}`);
          return result;
        } catch (error) {
          database.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
          throw error;
        }
      },
  } as unknown as Database.Database;
}
function conversation(projectId: string | null = null, archived = false) {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO conversations(id,project_id,title,provider_id,updated_at,archived) VALUES (?,?,?,?,?,?)',
  ).run(id, projectId, 'Saved conversation', 'openai', new Date().toISOString(), +archived);
  return id;
}
function message(conversationId: string, text = 'needle preserved answer') {
  const session = randomUUID(),
    turn = randomUUID(),
    id = randomUUID();
  db.prepare('INSERT INTO provider_sessions VALUES (?,?,?,?,?,?,?,?,?)').run(
    session,
    conversationId,
    'openai',
    null,
    'fixture',
    'chat',
    '{}',
    new Date().toISOString(),
    'revision',
  );
  db.prepare(
    'INSERT INTO turns(id,conversation_id,session_id,request_id,status,created_at) VALUES (?,?,?,?,?,?)',
  ).run(turn, conversationId, session, randomUUID(), 'completed', new Date().toISOString());
  db.prepare(
    'INSERT INTO messages(id,conversation_id,session_id,turn_id,role,text,status,provider_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    conversationId,
    session,
    turn,
    'assistant',
    text,
    'completed',
    'openai',
    new Date().toISOString(),
  );
  return id;
}
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of [
    '001_initial.sql',
    '002_conversation_effort.sql',
    '003_daily_workspace.sql',
    '008_organization.sql',
  ])
    db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  organization = new OrganizationService(adapter(db));
});
afterEach(() => db.close());

describe('conversation organization persistence', () => {
  it('deduplicates normalized tag names and updates all assigned labels', () => {
    const tag = organization.createTag('  Research  ');
    expect(organization.createTag('RESEARCH')).toEqual(tag);
    expect(organization.createTag('ＲＥＳＥＡＲＣＨ')).toEqual(tag);
    const first = conversation(),
      second = conversation();
    organization.setConversationTags(first, [tag.id, tag.id]);
    organization.copyTags(first, second);
    organization.renameTag(tag.id, 'Reading');
    expect(organization.exportTags(first)).toEqual(['Reading']);
    expect(organization.exportTags(second)).toEqual(['Reading']);
    organization.deleteTag(tag.id);
    expect(organization.conversationTags(first)).toEqual([]);
    expect(db.prepare('SELECT id FROM conversations WHERE id=?').get(first)).toBeTruthy();
  });
  it('rejects missing labels atomically and handles archive/tag import', () => {
    const id = conversation(null, true),
      tag = organization.createTag('Keep');
    organization.setConversationTags(id, [tag.id]);
    expect(() => organization.setConversationTags(id, [randomUUID()])).toThrow('Tag not found');
    expect(organization.exportTags(id)).toEqual(['Keep']);
    organization.importTags(id, ['keep', 'Writing', 'WRITING']);
    expect(organization.exportTags(id)).toEqual(['Keep', 'Writing']);
    expect(() => organization.importTags(randomUUID(), ['Rollback'])).toThrow(
      'Conversation not found',
    );
    expect(organization.tags().some((tag) => tag.name === 'Rollback')).toBe(false);
    db.prepare('UPDATE conversations SET archived=0 WHERE id=?').run(id);
    expect(organization.exportTags(id)).toEqual(['Keep', 'Writing']);
  });
  it('enriches batches beyond a single SQL binding page', () => {
    const conversations = Array.from({ length: 505 }, () => ({ id: conversation() }));
    const tag = organization.createTag('Batch');
    organization.setConversationTags(conversations[504].id, [tag.id]);
    const enriched = organization.enrich(conversations);
    expect(enriched[0].tags).toEqual([]);
    expect(enriched[504].tags).toEqual([tag]);
    expect(organization.enrich([])).toEqual([]);
  });
  it('finds old tagged messages before applying result limits', () => {
    const old = conversation(),
      exactMessage = message(old),
      tag = organization.createTag('Older');
    organization.setConversationTags(old, [tag.id]);
    for (let index = 0; index < 150; index++) message(conversation());
    const results = organization.search('needle', { tagIds: [tag.id] });
    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe(exactMessage);
  });
  it('combines project, provider, archived and all-selected-tag filters', () => {
    const project = randomUUID();
    db.prepare('INSERT INTO projects VALUES (?,?,?)').run(
      project,
      'Research',
      new Date().toISOString(),
    );
    const id = conversation(project, true),
      single = conversation(project, true);
    const first = organization.createTag('One'),
      second = organization.createTag('Two');
    organization.setConversationTags(id, [first.id, second.id]);
    organization.setConversationTags(single, [first.id]);
    message(id);
    message(single);
    const filters = {
      projectId: project,
      providerId: 'openai' as const,
      tagIds: [first.id, second.id],
    };
    expect(organization.search('needle', filters)).toEqual([]);
    expect(
      organization.search('needle', { ...filters, archived: true }).map((r) => r.conversationId),
    ).toEqual([id]);
    expect(
      organization.search('', { ...filters, archived: true }).map((r) => r.conversationId),
    ).toEqual([id]);
    expect(
      organization.search('needle', { ...filters, archived: true, providerId: 'anthropic' }),
    ).toEqual([]);
    expect(organization.search('needle', { tagIds: [randomUUID()], archived: true })).toEqual([]);
  });
  it('rolls back the additive migration without touching existing transcripts', () => {
    const profile = new DatabaseSync(':memory:');
    try {
      for (const file of [
        '001_initial.sql',
        '002_conversation_effort.sql',
        '003_daily_workspace.sql',
      ])
        profile.exec(readFileSync(`migrations/${file}`, 'utf8'));
      const id = randomUUID();
      profile
        .prepare('INSERT INTO conversations(id,title,provider_id,updated_at) VALUES (?,?,?,?)')
        .run(id, 'Original', 'openai', '2026-10-12');
      profile.exec('BEGIN');
      profile.exec(readFileSync('migrations/008_organization.sql', 'utf8'));
      profile.exec('ROLLBACK');
      expect(
        profile.prepare("SELECT name FROM sqlite_master WHERE name='tags'").get(),
      ).toBeUndefined();
      expect(profile.prepare('SELECT title FROM conversations WHERE id=?').get(id)?.title).toBe(
        'Original',
      );
      profile.exec(readFileSync('migrations/008_organization.sql', 'utf8'));
      expect(profile.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      profile.close();
    }
  });
});

describe('prompt template persistence', () => {
  it('scopes templates and guards concurrent edits and deletes', () => {
    const project = randomUUID(),
      other = randomUUID();
    for (const id of [project, other])
      db.prepare('INSERT INTO projects VALUES (?,?,?)').run(id, 'Project', '2026-10-12');
    const global = organization.savePromptTemplate({ name: 'General', body: 'Global prompt' });
    const local = organization.savePromptTemplate({
      name: 'Local',
      body: 'Local prompt',
      projectId: project,
    });
    organization.savePromptTemplate({ name: 'Private', body: 'Other prompt', projectId: other });
    expect(organization.promptTemplates().map((t) => t.id)).toEqual([global.id]);
    expect(organization.promptTemplates(project).map((t) => t.id)).toEqual([global.id, local.id]);
    const input = {
      id: local.id,
      revision: local.revision,
      name: local.name,
      projectId: local.projectId,
    };
    const updated = organization.savePromptTemplate({ ...input, body: 'Updated prompt' });
    expect(updated.revision).toBe(2);
    expect(() => organization.savePromptTemplate({ ...input, body: 'Stale prompt' })).toThrow(
      'changed or was deleted',
    );
    expect(() => organization.deletePromptTemplate(local.id, 1)).toThrow('changed or was deleted');
    organization.deletePromptTemplate(local.id, 2);
    expect(organization.promptTemplates(project).map((t) => t.id)).toEqual([global.id]);
  });
  it('removes project templates without removing global templates', () => {
    const project = randomUUID();
    db.prepare('INSERT INTO projects VALUES (?,?,?)').run(project, 'Project', '2026-10-12');
    const global = organization.savePromptTemplate({ name: 'Global', body: 'Keep' });
    organization.savePromptTemplate({ name: 'Local', body: 'Remove', projectId: project });
    db.prepare('DELETE FROM projects WHERE id=?').run(project);
    expect(organization.promptTemplates()).toEqual([global]);
  });
  it('rejects invalid names, empty templates, mismatched revisions and overlong payloads', () => {
    expect(() => organization.createTag('\n')).toThrow();
    expect(() => organization.createTag('x'.repeat(41))).toThrow();
    expect(promptTemplateInputSchema.safeParse({ name: 'Name', body: ' ' }).success).toBe(false);
    expect(
      promptTemplateInputSchema.safeParse({ name: 'Name', body: 'Text', id: randomUUID() }).success,
    ).toBe(false);
    expect(
      promptTemplateInputSchema.safeParse({ name: 'Name', body: 'x'.repeat(100001) }).success,
    ).toBe(false);
    expect(
      organizationRoutes.setConversationTags.safeParse({
        conversationId: randomUUID(),
        tagIds: Array.from({ length: 21 }, randomUUID),
      }).success,
    ).toBe(false);
    expect(() =>
      organization.savePromptTemplate({ name: 'Name', body: 'Text', projectId: randomUUID() }),
    ).toThrow('Project not found');
  });
});

describe('template application', () => {
  it('previews explicit append and replacement without modifying the original', () => {
    const preview = {
      draftKey: 'chat',
      originalText: 'Original',
      body: 'Template',
      action: 'append' as const,
    };
    expect(templatePreviewText(preview)).toBe('Original\n\nTemplate');
    expect(applyTemplatePreview(preview, 'chat', 'Original')).toBe('Original\n\nTemplate');
    expect(applyTemplatePreview({ ...preview, action: 'replace' }, 'chat', 'Original')).toBe(
      'Template',
    );
    expect(preview.originalText).toBe('Original');
    expect(templatePreviewText({ ...preview, originalText: '' })).toBe('Template');
  });
  it('rejects changed conversations, changed drafts and aggregate prompt overflow', () => {
    const preview = {
      draftKey: 'chat',
      originalText: 'Original',
      body: 'Template',
      action: 'append' as const,
    };
    expect(() => applyTemplatePreview(preview, 'other', 'Original')).toThrow('draft changed');
    expect(() => applyTemplatePreview(preview, 'chat', 'New text')).toThrow('draft changed');
    expect(() =>
      applyTemplatePreview({ ...preview, body: 'x'.repeat(100000) }, 'chat', 'Original'),
    ).toThrow('size limit');
  });
});

import Database from 'better-sqlite3';
import { connectionSchema, settingsSchema } from '../../shared/schema';
import { connections } from '../../shared/defaults';
import { Store } from './store';
import { SUPPORTED_SCHEMA_VERSION } from '../../shared/storage-version';
import { validateFeatureData } from './validate-features';

export function validateDatabase(path: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const check = db.pragma('quick_check', { simple: true });
    if (check !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length)
      throw new Error('The backup database is corrupt.');
    const version = (
      db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
        version: number;
      }
    ).version;
    if (version > SUPPORTED_SCHEMA_VERSION || version < 1)
      throw new Error('This backup was created by an incompatible application version.');
    for (const table of [
      'projects',
      'workspaces',
      'provider_sessions',
      'turns',
      'messages',
      'message_blocks',
      'events',
      'interactions',
      'message_assets',
      'terminal_profiles',
      'conversations',
      'assets',
      'settings',
      'provider_connections',
      ...(version >= 3 ? ['drafts', 'project_defaults'] : []),
      ...(version >= 5 ? ['context_items', 'context_snapshots'] : []),
      ...(version >= 7
        ? [
            'artifacts',
            'artifact_revisions',
            'artifact_drafts',
            'artifact_revision_assets',
            'message_artifacts',
          ]
        : []),
      ...(version >= 8 ? ['tags', 'conversation_tags', 'prompt_templates'] : []),
      ...(version >= 9 ? ['comparison_groups', 'comparison_members'] : []),
    ])
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'").get(table))
        throw new Error('The backup is missing required data.');
    for (const row of db.prepare('SELECT config FROM provider_connections').all() as {
      config: string;
    }[]) {
      const config = connectionSchema.parse(JSON.parse(row.config));
      const expected = connections.find((c) => c.id === config.id);
      if (expected && config.kind !== expected.kind)
        throw new Error('The backup contains an invalid provider configuration.');
    }
    const settings = db.prepare("SELECT value FROM settings WHERE key='app'").get() as
      { value: string } | undefined;
    if (settings) settingsSchema.parse(JSON.parse(settings.value));
    return { version, assets: db.prepare('SELECT id,mime,type,size,hash FROM assets').all() };
  } finally {
    db.close();
  }
}
export function validateRestoredDatabase(path: string, migrations: string) {
  validateDatabase(path);
  const profile = new Store(path, migrations);
  try {
    profile.projects();
    profile.workspaces();
    profile.settings();
    for (const conversation of [...profile.conversations(), ...profile.conversations(true)])
      profile.view(conversation.id);
    validateFeatureData(profile);
    return validateDatabase(path);
  } finally {
    profile.close();
  }
}
export function sanitizeRestoredProfile(path: string) {
  const db = new Database(path, { fileMustExist: true });
  try {
    db.transaction(() => {
      for (const row of db.prepare('SELECT id,config FROM provider_connections').all() as {
        id: string;
        config: string;
      }[]) {
        const config = connectionSchema.parse(JSON.parse(row.config));
        if (config.kind === 'cli-agent')
          db.prepare('UPDATE provider_connections SET config=? WHERE id=?').run(
            JSON.stringify({ ...config, enabled: false, executable: '' }),
            row.id,
          );
      }
      db.prepare('UPDATE workspaces SET trusted=0').run();
    })();
  } finally {
    db.close();
  }
}

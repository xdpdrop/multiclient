ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'folder' CHECK(kind IN ('folder','chat'));
CREATE TABLE context_items (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('instructions','note','document','memory','web')),
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  revision INTEGER NOT NULL,
  include_new_chats INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  source TEXT,
  attachment TEXT
);
CREATE INDEX context_item_scope ON context_items(project_id,kind);
CREATE UNIQUE INDEX project_instruction_item ON context_items(project_id) WHERE kind='instructions';
CREATE TABLE context_snapshots (id TEXT PRIMARY KEY, content TEXT NOT NULL);
CREATE INDEX context_snapshot_item_revision ON context_snapshots(json_extract(content,'$.itemId'),json_extract(content,'$.revision'));

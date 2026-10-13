CREATE TABLE comparison_groups (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared', 'started')),
  context_characters INTEGER NOT NULL
);
CREATE TABLE comparison_members (
  group_id TEXT NOT NULL REFERENCES comparison_groups(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  configuration_revision TEXT NOT NULL,
  error TEXT,
  PRIMARY KEY(group_id, position)
);

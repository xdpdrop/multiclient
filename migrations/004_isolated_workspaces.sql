CREATE TABLE workspaces_new (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, path TEXT NOT NULL UNIQUE, trusted INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'primary', branch TEXT NOT NULL DEFAULT '', source_ref TEXT NOT NULL DEFAULT '', source_workspace_id TEXT, archived INTEGER NOT NULL DEFAULT 0);
INSERT INTO workspaces_new(id,project_id,path,trusted) SELECT id,project_id,path,trusted FROM workspaces;
DROP TABLE workspaces;
ALTER TABLE workspaces_new RENAME TO workspaces;
CREATE INDEX project_workspaces ON workspaces(project_id,kind,archived);

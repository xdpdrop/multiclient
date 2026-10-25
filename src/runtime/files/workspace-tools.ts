import { relative } from 'node:path';
import { z } from 'zod';
import { listFiles, readText, toCanonicalPath, workspacePath } from './index';

const argumentsSchema = z.object({ path: z.string().max(4096) }).strict();
const excluded = (path: string) =>
  path
    .split(/[\\/]/)
    .some(
      (part) =>
        [
          '.git',
          'node_modules',
          '.ssh',
          '.aws',
          '.azure',
          '.npmrc',
          '.netrc',
          'auth.json',
          'credentials.json',
        ].includes(part.toLowerCase()) ||
        /^\.env(?:\.|$)/i.test(part) ||
        /\.(pem|key)$/i.test(part),
    );

export const workspaceToolDefinitions = [
  {
    name: 'list_directory',
    description:
      'List files and subdirectories inside the selected project. Use path "." for its root. Read-only; excludes dependency directories and common credential files. Returns up to 200 entries with an explicit limit notice.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'read_file',
    description:
      'Read a UTF-8 text file inside the selected project (up to 100 KB). Use a project-relative path. Read-only; common credential files and paths outside the project are unavailable.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

export async function callWorkspaceTool(root: string, name: string, input: unknown) {
  if (!workspaceToolDefinitions.some((tool) => tool.name === name))
    throw new Error('Unknown workspace tool.');
  const { path } = argumentsSchema.parse(input);
  const base = await toCanonicalPath(root);
  const target = await workspacePath(base, path);
  if (excluded(path) || excluded(relative(base, target)))
    throw new Error('This path is excluded from agent file access.');
  if (name === 'read_file')
    return { path: relative(base, target), content: await readText(base, target) };
  const listed = await listFiles(base, target);
  const entries = listed.filter((entry) => !excluded(entry.path));
  const truncated = listed.length === 2000 || entries.length > 200;
  return {
    path: relative(base, target) || '.',
    entries: entries.slice(0, 200),
    truncated,
    ...(truncated
      ? {
          notice:
            'Listing limited to 200 entries; inspect individual subdirectories for more detail.',
        }
      : {}),
  };
}

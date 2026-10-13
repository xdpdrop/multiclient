import { realpath, readdir, stat, open } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
export function contained(root: string, target: string) {
  const rel = relative(root, target);
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'))
  );
}
export async function workspacePath(root: string, input: string) {
  const base = await realpath(root);
  const target = await realpath(resolve(base, input || '.'));
  if (!contained(base, target)) throw new Error('Path is outside this workspace.');
  return target;
}
export async function listFiles(root: string, input: string) {
  const path = await workspacePath(root, input);
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((e) => !['.git', 'node_modules', '.env'].includes(e.name) && !e.isSymbolicLink())
    .slice(0, 2000)
    .map((e) => ({
      name: e.name,
      path: relative(root, resolve(path, e.name)),
      directory: e.isDirectory(),
    }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}
export async function readText(root: string, input: string) {
  const path = await workspacePath(root, input);
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Select a regular file.');
    if (info.size > 100000) throw new Error('This preview supports text files up to 100 KB.');
    const buffer = Buffer.alloc(100001);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > 100000) throw new Error('This preview supports text files up to 100 KB.');
    const content = buffer.subarray(0, bytesRead);
    if (content.includes(0)) throw new Error('Binary files cannot be attached as text.');
    return content.toString('utf8');
  } finally {
    await handle.close();
  }
}
export async function canonicalDirectory(path: string) {
  const value = await realpath(path);
  if (!(await stat(value)).isDirectory()) throw new Error('Choose a directory.');
  return value;
}

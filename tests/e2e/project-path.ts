import { realpath } from 'node:fs/promises';

export type AddedProject = {
  id: string;
  name: string;
  path?: string | null;
  kind?: string;
};

function leafName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export async function addedProjectId(projects: readonly AddedProject[], selected: string) {
  let canonical = selected;
  try {
    canonical = await realpath(selected);
  } catch {
    canonical = selected;
  }
  const folders = projects.filter((project) => project.kind !== 'chat' && project.path);
  const exact = folders.find((project) => project.path === canonical || project.path === selected);
  if (exact) return exact.id;
  const leaf = leafName(canonical);
  const named = folders.filter(
    (project) => project.name === leaf || leafName(project.path!) === leaf,
  );
  if (named.length === 1) return named[0].id;
  throw new Error(
    `Project not found for ${selected} (${canonical}). Known: ${folders.map((project) => project.path).join(', ')}`,
  );
}

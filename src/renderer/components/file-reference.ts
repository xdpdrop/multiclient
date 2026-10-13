export type FileReference = { path: string; line?: number };

export function isLocalAssetUrl(value: string) {
  return /^media:\/\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function parseFileReference(href: string, projectPath: string): FileReference | null {
  let value: string;
  try {
    value = decodeURIComponent(href);
  } catch {
    return null;
  }
  if (!value || /[\u0000-\u001f?]/.test(value) || /^https?:/i.test(value)) return null;
  const position = value.match(/(?:#L?|:)(\d+)(?::\d+|-L?\d+)?$/i);
  const line = position ? Number(position[1]) : undefined;
  if (position) value = value.slice(0, position.index);
  if (line !== undefined && (!Number.isSafeInteger(line) || line < 1 || line > 1000000))
    return null;
  if (/^file:\/\/\//i.test(value)) value = value.replace(/^file:\/\//i, '');
  const windows = /^[a-z]:[/\\]/i.test(projectPath);
  if (windows) value = value.replace(/^\/([a-z]:)/i, '$1');
  value = value.replace(/\\/g, '/');
  const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[a-z]:\//i.test(value) || value.startsWith('/')) {
    const candidate = windows ? value.toLowerCase() : value;
    const base = windows ? root.toLowerCase() : root;
    if (!candidate.startsWith(base + '/')) return null;
    value = value.slice(root.length + 1);
  } else if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  value = value.replace(/^\.\//, '');
  const parts = value.split('/');
  if (
    parts.some(
      (part) => !part || part === '..' || part === '.' || part.includes(':') || part.includes('#'),
    )
  )
    return null;
  return { path: parts.join('/'), ...(line !== undefined ? { line } : {}) };
}

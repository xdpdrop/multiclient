import { mkdtemp, readFile, writeFile, mkdir, stat, rename, rm, access } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { id } from '../shared/schema';
import { contained, toCanonicalPathOrAncestor } from '../runtime/files';
import type { Message, Conversation } from '../shared/types';
import type { RuntimeHost } from './runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sanitizeRestoredProfile } from '../runtime/storage/backup';
import { formatContextSources } from '../shared/context';

const compress = promisify(gzip);
const expand = promisify(gunzip);
const MAX_BACKUP = 256 * 1024 * 1024;
const assetSchema = z
  .object({
    id,
    mime: z.string().max(100),
    type: z.enum(['image', 'gif', 'video', 'pdf']),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    data: z.string().max(140 * 1024 * 1024),
  })
  .strict();
const backupSchema = z
  .object({
    format: z.literal('multiclient-backup'),
    version: z.literal(1),
    database: z.string().max(Math.ceil((MAX_BACKUP * 4) / 3) + 4),
    assets: z.array(assetSchema).max(10000),
  })
  .strict();

export function markdownTranscript(conversation: Conversation, messages: Message[]) {
  return (
    `# ${conversation.title}\n\nExported from Multiclient. Provider: ${conversation.providerId}; model: ${conversation.model || 'provider default'}.\n\n` +
    messages
      .map(
        (m) =>
          `## ${m.role === 'user' ? 'You' : m.providerId} — ${m.createdAt}\n\n${m.text}${m.context ? `\n\n<details>\n<summary>Shared context</summary>\n\n${m.context}\n\n</details>` : ''}${
            m.contextSources
              ?.map(
                (source) =>
                  `\n\n### Shared source: ${source.title} (revision ${source.revision})\n\n${source.source?.url ? `Original: ${source.source.url}\n\n` : ''}${source.text
                    .split('\n')
                    .map((line) => '    ' + line)
                    .join('\n')}`,
              )
              .join('') ?? ''
          }${m.artifactReferences?.length ? '\n\nSaved artifacts: ' + m.artifactReferences.map((reference) => `${reference.artifactId}, revision ${reference.revisionId}`).join('; ') : ''}${m.attachments?.length ? '\n\nAttachments: ' + m.attachments.map((a) => a.name ?? a.path).join(', ') : ''}`,
      )
      .join('\n\n---\n\n') +
    '\n'
  );
}
export async function printTranscript(conversation: Conversation, messages: Message[]) {
  const [ReactMarkdown, remarkGfm] = await Promise.all([
    import('react-markdown'),
    import('remark-gfm'),
  ]);
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
  const content = messages
    .map((m) => {
      const markdown = renderToStaticMarkup(
        createElement(
          ReactMarkdown.default,
          {
            skipHtml: true,
            remarkPlugins: [remarkGfm.default],
            components: {
              img: ({ alt }) => createElement('span', null, `[Image: ${alt ?? 'not loaded'}]`),
            },
          },
          m.text,
        ),
      );
      const attachments =
        m.attachments
          ?.map(
            (a) =>
              `${a.kind === 'image' && a.assetId && id.safeParse(a.assetId).success ? `<img src="media://assets/${a.assetId}" alt="${escape(a.name ?? a.path)}">` : ''}<p>Attachment: ${escape(a.name ?? a.path)}</p>`,
          )
          .join('') ?? '';
      const context = m.context
        ? `<section><h3>Shared context</h3><pre>${escape(m.context)}</pre></section>`
        : '';
      const sources = (m.contextSources ?? [])
        .map(
          (source) =>
            `<section><h3>${escape(source.title)} · revision ${source.revision}</h3><pre>${escape(formatContextSources([source]))}</pre></section>`,
        )
        .join('');
      const artifacts = (m.artifactReferences ?? [])
        .map(
          (reference) =>
            `<p>Saved artifact ${escape(reference.artifactId)} · revision ${escape(reference.revisionId)}</p>`,
        )
        .join('');
      return `<article><h2>${escape(m.role === 'user' ? 'You' : m.providerId)}</h2><small>${escape(m.createdAt)}</small>${markdown}${context}${sources}${artifacts}${attachments}</article>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src media:"><style>body{font:12pt system-ui;line-height:1.5;color:#222}h1{font-size:22pt}h2{font-size:14pt}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:10pt}article{border-bottom:1px solid #ccc;padding-bottom:12pt}small{color:#555}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:5pt;text-align:left}img{max-width:100%;max-height:180mm;object-fit:contain}a{color:#245080}</style></head><body><h1>${escape(conversation.title)}</h1>${content}</body></html>`;
}
export async function embeddedAssets(dataDir: string, assets: unknown[]) {
  const result = [];
  let total = 0;
  for (const raw of assets) {
    const asset = raw as z.infer<typeof assetSchema>;
    id.parse(asset.id);
    const bytes = await readFile(join(dataDir, 'assets', asset.id));
    total += bytes.length;
    if (total > MAX_BACKUP) throw new Error('The assets exceed the 256 MB export limit.');
    if (
      bytes.length !== asset.size ||
      createHash('sha256').update(bytes).digest('hex') !== asset.hash
    )
      throw new Error('An attachment asset is missing or damaged.');
    result.push({ ...asset, data: bytes.toString('base64') });
  }
  return result;
}
export async function writeBackup(host: RuntimeHost, dataDir: string, path: string) {
  const temporary = await mkdtemp(join(dataDir, 'backup-'));
  try {
    const databasePath = join(temporary, 'snapshot.sqlite');
    const assets = await host.request('backupData', { path: databasePath });
    const database = await readFile(databasePath);
    const embedded = await embeddedAssets(dataDir, assets);
    if (database.length + embedded.reduce((sum, a) => sum + a.size, 0) > MAX_BACKUP)
      throw new Error('The profile exceeds the 256 MB backup limit.');
    const bytes = await compress(
      Buffer.from(
        JSON.stringify({
          format: 'multiclient-backup',
          version: 1,
          database: database.toString('base64'),
          assets: embedded,
        }),
      ),
    );
    const staged = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    try {
      await writeFile(staged, bytes, { flag: 'wx' });
      await rename(staged, path);
    } finally {
      await rm(staged, { force: true });
    }
  } finally {
    if (
      contained(
        await toCanonicalPathOrAncestor(dataDir),
        await toCanonicalPathOrAncestor(temporary),
      )
    )
      await rm(temporary, { recursive: true, force: true });
  }
}
export async function prepareRestore(host: RuntimeHost, dataDir: string, path: string) {
  if ((await stat(path)).size > MAX_BACKUP)
    throw new Error('The backup exceeds the 256 MB restore limit.');
  const bytes = await expand(await readFile(path), { maxOutputLength: MAX_BACKUP * 2 });
  const backup = backupSchema.parse(JSON.parse(bytes.toString('utf8')));
  const temporary = await mkdtemp(join(dataDir, 'restore-'));
  try {
    await writeFile(join(temporary, 'multiclient.sqlite'), Buffer.from(backup.database, 'base64'));
    const checked = await host.request('validateBackup', {
      path: join(temporary, 'multiclient.sqlite'),
    });
    await mkdir(join(temporary, 'assets'));
    const assetIds = new Set<string>();
    for (const asset of backup.assets) {
      if (assetIds.has(asset.id)) throw new Error('The backup contains duplicate assets.');
      assetIds.add(asset.id);
      const data = Buffer.from(asset.data, 'base64');
      if (
        data.length !== asset.size ||
        createHash('sha256').update(data).digest('hex') !== asset.hash
      )
        throw new Error('A backup asset is corrupt.');
      const registered = checked.assets.find((a: { id: string }) => a.id === asset.id);
      if (
        !registered ||
        registered.hash !== asset.hash ||
        registered.size !== asset.size ||
        registered.mime !== asset.mime ||
        registered.type !== asset.type
      )
        throw new Error('Backup assets do not match its database.');
      await writeFile(join(temporary, 'assets', asset.id), data, { flag: 'wx' });
    }
    if (assetIds.size !== checked.assets.length) throw new Error('The backup is missing assets.');
    // A backup is data, not authorization to launch its saved executable paths.
    sanitizeRestoredProfile(join(temporary, 'multiclient.sqlite'));
    return temporary;
  } catch (error) {
    if (
      contained(
        await toCanonicalPathOrAncestor(dataDir),
        await toCanonicalPathOrAncestor(temporary),
      )
    )
      await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
export async function installRestore(host: RuntimeHost, dataDir: string, temporary: string) {
  if (
    !contained(await toCanonicalPathOrAncestor(dataDir), await toCanonicalPathOrAncestor(temporary))
  )
    throw new Error('Invalid restore staging directory.');
  const rollback = await mkdtemp(join(dataDir, 'previous-profile-'));
  const moved: string[] = [];
  const installed: string[] = [];
  await host.stop();
  try {
    for (const name of [
      'multiclient.sqlite',
      'multiclient.sqlite-wal',
      'multiclient.sqlite-shm',
      'assets',
    ]) {
      try {
        await access(join(dataDir, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      await rename(join(dataDir, name), join(rollback, name));
      moved.push(name);
    }
    for (const name of ['multiclient.sqlite', 'assets']) {
      await rename(join(temporary, name), join(dataDir, name));
      installed.push(name);
    }
    await host.start();
    await host.request('snapshot');
    // Projects from a restored profile must be trusted again before execution.
    const snapshot = await host.request('snapshot');
    for (const project of snapshot.projects)
      if (project.trusted) await host.request('trustProject', { id: project.id, trusted: false });
    return rollback;
  } catch (error) {
    await host.stop();
    const replacementFiles = installed.includes('multiclient.sqlite')
      ? [...installed, 'multiclient.sqlite-wal', 'multiclient.sqlite-shm']
      : installed;
    for (const name of replacementFiles)
      await rm(join(dataDir, name), { recursive: name === 'assets', force: true });
    for (const name of moved) await rename(join(rollback, name), join(dataDir, name));
    await host.start();
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
export { assetSchema };

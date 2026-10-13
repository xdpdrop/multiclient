import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { fileRequestAllowed } from '../../src/main/artifacts';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function temp(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

it('treats %7E and a literal tilde as the same allowlisted file', async () => {
  const directory = await temp('runner~1-');
  const file = join(directory, 'index.html');
  await writeFile(file, '<html></html>');
  const allowed = pathToFileURL(file).href;
  expect(allowed).toContain('%7E');
  const requested = allowed.replaceAll('%7E', '~');
  expect(requested).not.toBe(allowed);
  expect(fileRequestAllowed(requested, new Set([allowed]))).toBe(true);
  const sibling = pathToFileURL(join(directory, 'secret.html')).href.replaceAll('%7E', '~');
  expect(fileRequestAllowed(sibling, new Set([allowed]))).toBe(false);
});

it('accepts the real path of an allowlisted symlink and still rejects neighbors', async () => {
  const real = await temp('diagram-real-');
  const index = join(real, 'index.html');
  const secret = join(real, 'secret.html');
  await writeFile(index, '<html></html>');
  await writeFile(secret, 'no');
  const linkParent = await temp('diagram-link-');
  const link = join(linkParent, 'short');
  await symlink(real, link);
  const allowed = pathToFileURL(join(link, 'index.html')).href;
  const requested = pathToFileURL(index).href;
  expect(allowed).not.toBe(requested);
  expect(fileRequestAllowed(requested, new Set([allowed]))).toBe(true);
  expect(fileRequestAllowed(pathToFileURL(secret).href, new Set([allowed]))).toBe(false);
  const pending = 'pending.html';
  expect(
    fileRequestAllowed(
      pathToFileURL(join(real, pending)).href,
      new Set([pathToFileURL(join(link, pending)).href]),
    ),
  ).toBe(true);
  const evil = join(linkParent, 'evil.html');
  await symlink(secret, evil);
  expect(fileRequestAllowed(pathToFileURL(evil).href, new Set([pathToFileURL(index).href]))).toBe(
    false,
  );
});

it('does not widen the allowlist to prefixes, traversals, or other schemes', async () => {
  const directory = await temp('diagram-guard-');
  const index = join(directory, 'index.html');
  const prefix = join(directory, 'index');
  await writeFile(index, '<html></html>');
  await writeFile(prefix, 'x');
  const allowed = pathToFileURL(index).href;
  expect(fileRequestAllowed(allowed, new Set([allowed]))).toBe(true);
  expect(fileRequestAllowed(pathToFileURL(prefix).href, new Set([allowed]))).toBe(false);
  expect(fileRequestAllowed(pathToFileURL(directory).href, new Set([allowed]))).toBe(false);
  const escaped = new URL(allowed);
  escaped.pathname = `${escaped.pathname}/../secret.html`;
  expect(fileRequestAllowed(escaped.href, new Set([allowed]))).toBe(false);
  expect(
    fileRequestAllowed(
      allowed.replace('index.html', 'index.html%2F..%2Fsecret.html'),
      new Set([allowed]),
    ),
  ).toBe(false);
  expect(fileRequestAllowed('https://example.com/index.html', new Set([allowed]))).toBe(false);
  expect(fileRequestAllowed('file://evil.example/tmp/index.html', new Set([allowed]))).toBe(false);
  expect(fileRequestAllowed('data:text/html,hi', new Set())).toBe(true);
});

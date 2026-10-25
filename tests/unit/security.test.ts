import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { sendSchema, appearanceSchema, routes } from '../../src/shared/schema';
import { defaultSettings, capabilities } from '../../src/shared/defaults';
import { contained, toCanonicalPath, toCanonicalPathOrAncestor } from '../../src/runtime/files';
import { validateEndpoint } from '../../src/runtime/providers/api';
import { childEnvironment } from '../../src/runtime/providers/process';
import { parseStatus } from '../../src/runtime/git';
import { resolve, join } from 'node:path';
describe('trust boundaries', () => {
  it('rejects malformed commands and arbitrary theme properties', () => {
    expect(() => sendSchema.parse({ conversationId: '../secrets' })).toThrow();
    expect(() => appearanceSchema.parse({ ...defaultSettings.appearance, css: 'evil' })).toThrow();
    expect(() =>
      routes.terminalResize.parse({ id: crypto.randomUUID(), cols: 999999, rows: 10 }),
    ).toThrow();
  });
  it('contains siblings and traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'multiclient-contained-'));
    try {
      const baseDir = join(root, 'test-root');
      const child = join(baseDir, 'child');
      const sibling = join(root, 'test-root-other');
      await mkdir(child, { recursive: true });
      await mkdir(sibling);
      await mkdir(join(root, 'outside'));
      const base = await toCanonicalPath(baseDir);
      expect(contained(base, await toCanonicalPath(child))).toBe(true);
      expect(contained(base, await toCanonicalPath(sibling))).toBe(false);
      expect(contained(base, await toCanonicalPath(root))).toBe(false);
      expect(
        contained(base, await toCanonicalPathOrAncestor(`${baseDir}/missing/../../outside`)),
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rejects a raw string at a containment check', () => {
    const base = resolve('test-root');
    // @ts-expect-error raw strings are not canonical paths
    contained(base, join(base, 'child'));
  });
  it('never injects API or subscription credentials into a CLI', () => {
    process.env.OPENAI_API_KEY = 'secret';
    process.env.ANTHROPIC_AUTH_TOKEN = 'secret';
    process.env.CURSOR_API_KEY = 'secret';
    process.env.NODE_OPTIONS = '--require evil';
    const env = childEnvironment();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CURSOR_API_KEY).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.CURSOR_API_KEY;
    delete process.env.NODE_OPTIONS;
  });
  it('requires secure remote API endpoints', () => {
    expect(validateEndpoint('https://example.com/v1/')).toBe('https://example.com/v1');
    expect(validateEndpoint('http://127.0.0.1:1234/v1')).toContain('127.0.0.1');
    expect(() => validateEndpoint('http://example.com')).toThrow();
    expect(() => validateEndpoint('https://user:pass@example.com')).toThrow();
  });
  it('exposes editing only through explicit CLI Code mode', () => {
    for (const id of ['codex', 'claude-code', 'cursor'] as const) {
      expect(
        capabilities(id)
          .modes.filter((m) => m.workspaceAccess === 'write')
          .map((m) => m.id),
      ).toEqual(['code', 'code-bypass']);
      expect(capabilities(id).modes[0].id).toBe('ask');
    }
    for (const id of ['openai', 'anthropic', 'compatible'] as const)
      expect(capabilities(id).modes.some((m) => m.workspaceAccess !== 'none')).toBe(false);
  });
  it('parses NUL-delimited Git renames and filenames containing spaces', () => {
    expect(parseStatus(' M file with spaces.ts\0R  new.ts\0old.ts\0?? new file.txt\0')).toEqual([
      { status: ' M', path: 'file with spaces.ts' },
      { status: 'R ', path: 'new.ts' },
      { status: '??', path: 'new file.txt' },
    ]);
  });
});

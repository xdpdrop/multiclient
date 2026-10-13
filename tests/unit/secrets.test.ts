import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeStorage } from 'electron';
import { Secrets } from '../../src/main/secrets';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().slice('encrypted:'.length)),
  },
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
let directory = '';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'multiclient-secrets-test-'));
});
afterEach(async () => {
  vi.clearAllMocks();
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  await rm(directory, { recursive: true, force: true });
});
describe('credential durability', () => {
  it('persists encrypted credentials across instances', async () => {
    const secrets = new Secrets(directory);
    await expect(secrets.set('openai', 'new-key', true)).resolves.toEqual({ persisted: true });
    expect((await readFile(join(directory, 'openai'))).toString()).toBe('encrypted:new-key');
    await expect(new Secrets(directory).get('openai')).resolves.toBe('new-key');
  });
  it('preserves the previous credential when atomic replacement fails', async () => {
    const secrets = new Secrets(directory);
    await secrets.set('openai', 'old-key', true);
    vi.mocked(rename).mockRejectedValueOnce(new Error('simulated write failure'));
    await expect(secrets.set('openai', 'new-key', true)).rejects.toThrow('simulated');
    await expect(new Secrets(directory).get('openai')).resolves.toBe('old-key');
  });
  it('removes an old persisted key when switching to memory or deleting', async () => {
    const secrets = new Secrets(directory);
    await secrets.set('openai', 'old-key', true);
    await secrets.set('openai', 'temporary-key', false);
    await expect(secrets.get('openai')).resolves.toBe('temporary-key');
    await expect(new Secrets(directory).get('openai')).resolves.toBeUndefined();
    await secrets.set('openai', '', false);
    await expect(secrets.get('openai')).resolves.toBeUndefined();
  });
  it('never persists plaintext when OS encryption is unavailable', async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const secrets = new Secrets(directory);
    await expect(secrets.set('anthropic', 'temporary-key', true)).resolves.toEqual({
      persisted: false,
    });
    await expect(secrets.get('anthropic')).resolves.toBe('temporary-key');
    await expect(readFile(join(directory, 'anthropic'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

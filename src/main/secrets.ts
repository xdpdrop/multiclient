import { safeStorage } from 'electron';
import { mkdir, readFile, open, unlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CredentialId } from '../shared/types';
export class Secrets {
  private memory = new Map<CredentialId, string>();
  private writes = new Map<CredentialId, Promise<unknown>>();
  constructor(private dir: string) {}
  private secure() {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
    );
  }
  async get(id: CredentialId) {
    if (!['openai', 'anthropic', 'compatible', 'brave-search'].includes(id)) return undefined;
    if (this.memory.has(id)) return this.memory.get(id);
    if (!this.secure()) return undefined;
    try {
      return safeStorage.decryptString(await readFile(join(this.dir, id)));
    } catch {
      return undefined;
    }
  }
  async set(id: CredentialId, value: string, persist: boolean) {
    if (!['openai', 'anthropic', 'compatible', 'brave-search'].includes(id))
      throw new Error('CLI credentials must remain with the official CLI.');
    const previous = this.writes.get(id) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(() => this.write(id, value, persist));
    this.writes.set(id, write);
    try {
      return await write;
    } finally {
      if (this.writes.get(id) === write) this.writes.delete(id);
    }
  }
  private async write(id: CredentialId, value: string, persist: boolean) {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, id);
    const persisted = !!value && persist && this.secure();
    if (persisted) {
      const encrypted = safeStorage.encryptString(value);
      const temporary = join(this.dir, `.${id}-${randomUUID()}.tmp`);
      try {
        const file = await open(temporary, 'wx', 0o600);
        try {
          await file.writeFile(encrypted);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    } else {
      await unlink(path).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    this.memory.delete(id);
    if (value && !persisted) this.memory.set(id, value);
    return { persisted };
  }
}

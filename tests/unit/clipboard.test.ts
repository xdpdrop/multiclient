import { it, expect, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { copyTextHandler } from '../../src/main/clipboard';

const event = {} as IpcMainInvokeEvent;
it('keeps the copy IPC pending until Electron finishes its asynchronous clipboard write', async () => {
  let finish!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const handler = copyTextHandler({ writeText }, vi.fn());
  let completed = false;
  const operation = handler(event, { text: 'const ok = true;\n' }).then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledWith('const ok = true;\n');
  expect(completed).toBe(false);
  finish();
  await operation;
  expect(completed).toBe(true);
});
it('propagates an asynchronous clipboard failure instead of reporting successful copying', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Clipboard is unavailable'));
  await expect(
    copyTextHandler({ writeText }, vi.fn())(event, { text: 'Keep this text' }),
  ).rejects.toThrow('Clipboard is unavailable');
});
it('validates the trusted sender and payload before touching the clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const handler = copyTextHandler({ writeText }, () => {
    throw new Error('Untrusted sender');
  });
  await expect(handler(event, { text: 'Secret' })).rejects.toThrow('Untrusted sender');
  await expect(
    copyTextHandler({ writeText }, vi.fn())(event, { text: 'text', extra: true }),
  ).rejects.toThrow();
  expect(writeText).not.toHaveBeenCalled();
});

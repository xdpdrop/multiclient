import type { Clipboard, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';

const copyTextSchema = z.object({ text: z.string().max(2 * 1024 * 1024) }).strict();
export function copyTextHandler(
  clipboard: Pick<Clipboard, 'writeText'>,
  trustedSender: (event: IpcMainInvokeEvent) => void,
) {
  return async (event: IpcMainInvokeEvent, input: unknown) => {
    trustedSender(event);
    const value = copyTextSchema.parse(input);
    await clipboard.writeText(value.text);
  };
}

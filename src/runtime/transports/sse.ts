export async function* sse(
  body: ReadableStream<Uint8Array>,
  maxEventBytes = 8 * 1024 * 1024,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data: string[] = [];
  let eventBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        eventBytes += Buffer.byteLength(line, 'utf8') + 1;
        if (eventBytes > maxEventBytes) throw new Error('API stream message exceeded limit.');
        if (!line) {
          if (data.length) yield { event, data: data.join('\n') };
          event = 'message';
          data = [];
          eventBytes = 0;
        } else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (eventBytes + Buffer.byteLength(buffer, 'utf8') > maxEventBytes)
        throw new Error('API stream message exceeded limit.');
      if (next.done) {
        if (buffer.trim() || data.length)
          throw new Error('API stream ended with an incomplete event.');
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

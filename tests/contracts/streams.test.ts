import { describe, it, expect } from 'vitest';
import { NdjsonDecoder } from '../../src/runtime/transports/ndjson';
import { sse } from '../../src/runtime/transports/sse';
describe('structured streams', () => {
  it('decodes every byte boundary including Unicode', () => {
    const values: unknown[] = [];
    const parser = new NdjsonDecoder((v) => values.push(v));
    for (const byte of Buffer.from('{"text":"Hello 🌍"}\n{"id":2}\n'))
      parser.push(Buffer.from([byte]));
    parser.end();
    expect(values).toEqual([{ text: 'Hello 🌍' }, { id: 2 }]);
  });
  it('rejects malformed and unbounded messages', () => {
    expect(() => new NdjsonDecoder(() => {}).push(Buffer.from('oops\n'))).toThrow();
    expect(() => new NdjsonDecoder(() => {}, 4).push(Buffer.from('12345'))).toThrow();
  });
  it('supports fragmented SSE and ignores comments', async () => {
    const bytes = new TextEncoder().encode(
      ': ping\r\nevent: delta\r\ndata: {"text":"🌍"}\r\n\r\ndata: [DONE]\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const events = [];
    for await (const event of sse(stream)) events.push(event);
    expect(events).toEqual([
      { event: 'delta', data: '{"text":"🌍"}' },
      { event: 'message', data: '[DONE]' },
    ]);
  });
  it('rejects truncated SSE', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: partial'));
        c.close();
      },
    });
    await expect(async () => {
      for await (const _ of sse(stream)) {
        /* Consume. */
      }
    }).rejects.toThrow('incomplete');
  });
  it('bounds accumulated multiline SSE events and cancels the reader', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 12345\ndata: 12345\ndata: 12345\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(async () => {
      for await (const _ of sse(stream, 20)) {
      }
    }).rejects.toThrow('limit');
    expect(cancelled).toBe(true);
  });
  it('resets the bound between individual events in one network chunk', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: a\n\ndata: b\n\n'));
        controller.close();
      },
    });
    const events = [];
    for await (const event of sse(stream, 10)) events.push(event.data);
    expect(events).toEqual(['a', 'b']);
  });
});

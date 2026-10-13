import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
  body: Buffer.alloc(0),
  options: undefined as any,
}));
vi.mock('node:https', () => ({
  request: (_url: URL, options: unknown, callback: (response: any) => void) => {
    state.options = options;
    const request = new EventEmitter() as any;
    request.setTimeout = vi.fn();
    request.destroy = vi.fn();
    request.end = () => {
      const response = Readable.from([state.body]);
      Object.assign(response, { headers: state.headers, statusCode: 200 });
      callback(response);
    };
    return request;
  },
}));
import { researchNetwork } from '../../src/runtime/research/network';
import { researchLimits } from '../../src/shared/research';
afterEach(() => {
  state.headers = {};
  state.body = Buffer.alloc(0);
  state.options = undefined;
});
describe('pinned HTTPS streaming driver', () => {
  it('uses the checked socket address, disables pooling and sends no default authorization or cookies', async () => {
    state.headers = { 'content-type': 'text/plain' };
    state.body = Buffer.from('saved');
    const result = await researchNetwork.get(
      new URL('https://example.com/report'),
      { address: '93.184.216.34', family: 4 },
      new AbortController().signal,
      researchLimits.pdfBytes,
    );
    expect(result.bytes.toString()).toBe('saved');
    const lookup = vi.fn();
    state.options.lookup('example.com', {}, lookup);
    expect(lookup).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(state.options.agent).toBe(false);
    expect(state.options.headers.authorization).toBeUndefined();
    expect(state.options.headers.cookie).toBeUndefined();
  });
  it('rejects a compression bomb while streaming decoded HTML bytes', async () => {
    state.headers = { 'content-type': 'text/html', 'content-encoding': 'gzip' };
    state.body = gzipSync(Buffer.alloc(researchLimits.htmlBytes + 1, 97));
    await expect(
      researchNetwork.get(
        new URL('https://example.com/report'),
        { address: '93.184.216.34', family: 4 },
        new AbortController().signal,
        researchLimits.pdfBytes,
      ),
    ).rejects.toThrow('decoded');
  });
  it('decodes a bounded gzip document correctly and rejects unknown encodings', async () => {
    state.headers = { 'content-type': 'text/plain', 'content-encoding': 'gzip' };
    state.body = gzipSync(Buffer.from('bounded text'));
    expect(
      (
        await researchNetwork.get(
          new URL('https://example.com/'),
          { address: '93.184.216.34', family: 4 },
          new AbortController().signal,
          researchLimits.pdfBytes,
        )
      ).bytes.toString(),
    ).toBe('bounded text');
    state.headers['content-encoding'] = 'unknown';
    await expect(
      researchNetwork.get(
        new URL('https://example.com/'),
        { address: '93.184.216.34', family: 4 },
        new AbortController().signal,
        researchLimits.pdfBytes,
      ),
    ).rejects.toThrow('compression');
  });
});

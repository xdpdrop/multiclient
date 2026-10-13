import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { mediaResponse } from '../../src/main/media';
it('serves bounded media ranges and rejects invalid ranges', async () => {
  const path = resolve('tests/contracts/fixtures/background.webm');
  const bytes = await readFile(path);
  const response = await mediaResponse(
    path,
    'video/webm',
    new Request('https://local.test', { headers: { range: 'bytes=4-15' } }),
  );
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe(`bytes 4-15/${bytes.length}`);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(4, 16));
  const invalid = await mediaResponse(
    path,
    'video/webm',
    new Request('https://local.test', { headers: { range: 'bytes=999999-' } }),
  );
  expect(invalid.status).toBe(416);
});

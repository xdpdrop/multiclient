import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

function pdf(pages: string[]) {
  const streams = pages.map((text) => `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${index + 4} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pages.map(
      (_, index) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pages.length + index + 4} 0 R >>`,
    ),
    ...streams.map((stream) => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
  ];
  let value = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(value.length);
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = value.length;
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Array.from(Buffer.from(value));
}

test('compiled Electron imports assets and sends only selected PDF text to a local chat endpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-assets-e2e-'));
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      if (request.url === '/v1/models') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
        return;
      }
      requests.push(JSON.parse(body));
      response.setHeader('Content-Type', 'text/event-stream');
      response.end(
        'data: {"choices":[{"delta":{"content":"Local fixture response"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local test server unavailable.');
  const endpoint = `http://127.0.0.1:${address.port}/v1`;
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    MULTICLIENT_TEST_MODE: '1',
    MULTICLIENT_TEST_DATA: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.MULTICLIENT_PACKAGED_PATH
      ? { executablePath: process.env.MULTICLIENT_PACKAGED_PATH, args: [] }
      : { args: [resolve('out/main/index.js')] }),
    env,
  });
  try {
    const page = await app.firstWindow();
    await expect
      .poll(() => page.evaluate(async () => (await window.desktop.snapshot()).connections.length))
      .toBeGreaterThan(0);
    const text = await page.evaluate(() =>
      window.desktop.attachBytes({
        name: 'notes.txt',
        mime: 'text/plain',
        bytes: Array.from(new TextEncoder().encode('Captured notes')),
      }),
    );
    expect(text).toMatchObject({ kind: 'text', content: 'Captured notes' });
    const png = Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3mEAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const image = await page.evaluate(
      (bytes) => window.desktop.attachBytes({ name: 'screenshot.png', mime: 'image/png', bytes }),
      png,
    );
    expect(image).toMatchObject({ kind: 'image', mime: 'image/png', assetId: expect.any(String) });
    const imagePreview = await page.evaluate(async (id) => {
      const url = `media://assets/${id}`;
      const response = await fetch(url);
      const preview = new Image();
      preview.src = url;
      await preview.decode();
      return {
        status: response.status,
        mime: response.headers.get('content-type'),
        width: preview.naturalWidth,
      };
    }, image.assetId);
    expect(imagePreview).toEqual({ status: 200, mime: 'image/png', width: 1 });
    const document = await page.evaluate(
      (bytes) => window.desktop.attachBytes({ name: 'report.pdf', mime: 'application/pdf', bytes }),
      pdf(['Private first page', 'Selected second page']),
    );
    expect(document.pages).toEqual([
      { page: 1, text: 'Private first page' },
      { page: 2, text: 'Selected second page' },
    ]);
    const documentPreview = await page.evaluate(async (id) => {
      const response = await fetch(`media://assets/${id}`);
      return {
        status: response.status,
        mime: response.headers.get('content-type'),
        bytes: (await response.arrayBuffer()).byteLength,
      };
    }, document.assetId);
    expect(documentPreview).toMatchObject({
      status: 200,
      mime: 'application/pdf',
      bytes: expect.any(Number),
    });
    const selected = await page.evaluate(
      (attachment) => window.desktop.selectPdfPages(attachment, [2]),
      document,
    );
    expect(selected.delivery).toBe('text');
    expect(selected.content).toContain('Selected second page');
    expect(selected.content).not.toContain('Private first page');
    const conversation = await page.evaluate(
      async ({ endpoint, selected }) => {
        const snapshot = await window.desktop.snapshot();
        const config = snapshot.connections.find((connection) => connection.id === 'compatible')!;
        await window.desktop.saveConnection({
          ...config,
          endpoint,
          model: 'fixture-model',
          enabled: true,
        });
        const chat = await window.desktop.createConversation();
        await window.desktop.send({
          conversationId: chat.id,
          requestId: crypto.randomUUID(),
          providerId: 'compatible',
          model: 'fixture-model',
          mode: 'chat',
          text: 'Summarize the selected page.',
          handoff: '',
          attachments: [selected],
        });
        return chat;
      },
      { endpoint, selected },
    );
    await expect.poll(() => requests.length).toBe(1);
    expect(JSON.stringify(requests[0])).toContain('Selected second page');
    expect(JSON.stringify(requests[0])).not.toContain('Private first page');
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.desktop.conversation(id)).messages.some(
              (message) => message.role === 'assistant' && message.status === 'completed',
            ),
          conversation.id,
        ),
      )
      .toBe(true);
    const history = await page.evaluate((id) => window.desktop.conversation(id), conversation.id);
    expect(
      history.messages.find((message) => message.role === 'user')?.attachments?.[0].content,
    ).toContain('Selected second page');
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

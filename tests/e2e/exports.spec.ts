import { test, expect } from './fixtures';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DesktopFixture } from './fixtures';

async function importFile(desktop: DesktopFixture, path: string) {
  await desktop.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, path);
  await desktop.page.getByRole('button', { name: 'Archive & backups', exact: true }).click();
  await desktop.page.getByRole('button', { name: 'Import conversation JSON', exact: true }).click();
  await expect(
    desktop.page.getByRole('dialog', { name: 'Archive & backups', exact: true }),
  ).toHaveCount(0);
}

test('native exports preserve Markdown, printable shared context and restorable embedded assets without inference', async ({
  desktop,
}) => {
  const { page, app, data } = desktop;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3mEAAAAASUVORK5CYII=',
    'base64',
  );
  const assetId = randomUUID();
  const title = 'Export fixture';
  const userText = '**Export bold fixture**\n\n| Option | Value |\n|---|---|\n| Fixture row | 42 |';
  const answer = '```ts\nconst exportFixture = true;\n```';
  const context =
    'EXPORTED_CONTEXT_MARKER\n\n**Visible shared context**\n\n<script>EXPORTED_SCRIPT_SENTINEL</script>';
  const source = join(data, 'source-conversation.json');
  await writeFile(
    source,
    JSON.stringify({
      format: 'multiclient-conversation',
      version: 1,
      conversation: { title, providerId: 'demo', model: '', mode: 'chat' },
      messages: [
        {
          role: 'user',
          providerId: 'demo',
          text: userText,
          context,
          status: 'sent',
          createdAt: '2026-10-12T10:00:00.000Z',
          attachments: [
            {
              kind: 'image',
              assetId,
              path: 'fixture.png',
              name: 'fixture.png',
              mime: 'image/png',
              size: png.length,
              content: '',
            },
          ],
        },
        {
          role: 'assistant',
          providerId: 'demo',
          text: answer,
          status: 'completed',
          createdAt: '2026-10-12T10:00:01.000Z',
          blocks: [{ id: 'answer', phase: 'answer', text: answer }],
        },
      ],
      assets: [
        {
          id: assetId,
          mime: 'image/png',
          type: 'image',
          size: png.length,
          hash: createHash('sha256').update(png).digest('hex'),
          data: png.toString('base64'),
        },
      ],
    }),
  );
  await page.evaluate(() => {
    (window as any).__exportTurnEvents = [];
    window.desktop.onEvent((event) => {
      if (event.type === 'turn-status') (window as any).__exportTurnEvents.push(event);
    });
  });
  await importFile(desktop, source);
  await expect(page.locator('[data-message-role="user"]')).toHaveCount(1);
  const original = await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return window.desktop.conversation(snapshot.conversations[0].id);
  });
  expect(original.messages.map((message) => message.text)).toEqual([userText, answer]);
  const paths = {
    markdown: join(data, 'conversation.md'),
    json: join(data, 'conversation.json'),
    pdf: join(data, 'conversation.pdf'),
  };
  await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Conversation', exact: true });
  for (const format of ['markdown', 'json', 'pdf'] as const) {
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, paths[format]);
    await options
      .getByRole('button', { name: `Export ${format.toUpperCase()}`, exact: true })
      .click();
    await expect
      .poll(
        async () => {
          try {
            return (await readFile(paths[format])).length;
          } catch {
            return 0;
          }
        },
        { timeout: 20000 },
      )
      .toBeGreaterThan(0);
  }
  await options.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const markdown = await readFile(paths.markdown, 'utf8');
  expect(markdown).toContain(`# ${title}`);
  expect(markdown).toContain(userText);
  expect(markdown).toContain(answer);
  expect(markdown).toContain('EXPORTED_CONTEXT_MARKER');
  expect(markdown).toContain('fixture.png');
  const exported = JSON.parse(await readFile(paths.json, 'utf8'));
  expect(exported).toMatchObject({ format: 'multiclient-conversation', version: 2 });
  expect(exported.assets).toHaveLength(1);
  expect(Buffer.from(exported.assets[0].data, 'base64')).toEqual(png);
  expect(exported.messages[0].attachments[0].assetId).toBe(exported.assets[0].id);
  const pdf = await readFile(paths.pdf);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, paths.pdf);
  const printed = await page.evaluate(async () => (await window.desktop.attachFiles())[0]);
  expect(printed.kind).toBe('pdf');
  const pdfText = printed.pages!.map((page) => page.text).join('\n');
  for (const value of [
    title,
    'Export bold fixture',
    'Fixture row',
    '42',
    'const exportFixture = true;',
    'EXPORTED_CONTEXT_MARKER',
    'fixture.png',
  ])
    expect(pdfText).toContain(value);
  expect(pdfText).not.toContain('|---|---|');
  expect(pdfText).toContain('Visible shared context');
  expect(pdfText).toContain('EXPORTED_SCRIPT_SENTINEL');

  await importFile(desktop, paths.json);
  const restored = await page.evaluate(async (originalId) => {
    const snapshot = await window.desktop.snapshot();
    const conversation = snapshot.conversations.find(
      (conversation) => conversation.id !== originalId,
    )!;
    return { snapshot, view: await window.desktop.conversation(conversation.id) };
  }, original.conversation.id);
  expect(restored.snapshot.activeTurns).toEqual([]);
  expect(restored.view.messages.map((message) => message.text)).toEqual([userText, answer]);
  expect(restored.view.messages[0].context).toBe(context);
  expect(restored.view.messages[1].blocks).toEqual(original.messages[1].blocks);
  const restoredAsset = restored.view.messages[0].attachments![0].assetId!;
  expect(restoredAsset).not.toBe(exported.assets[0].id);
  expect(
    await page.evaluate(
      async (id) =>
        Array.from(new Uint8Array(await (await fetch(`media://assets/${id}`)).arrayBuffer())),
      restoredAsset,
    ),
  ).toEqual(Array.from(png));
  expect(await page.evaluate(() => (window as any).__exportTurnEvents)).toEqual([]);
  await desktop.restart();
  await desktop.page.getByRole('button', { name: title, exact: true }).last().click();
  await expect(desktop.page.locator('[data-message-role="user"]')).toHaveCount(1);
  expect(
    await desktop.page.evaluate(async () => (await window.desktop.snapshot()).activeTurns),
  ).toEqual([]);
});

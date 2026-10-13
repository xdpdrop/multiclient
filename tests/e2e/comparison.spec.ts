import { createServer } from 'node:http';
import { test, expect } from './fixtures';

test('compare models sends identical reviewed context, persists results and continues an immutable chosen answer', async ({
  desktop,
}) => {
  const requests: { model: string; messages: unknown[] }[] = [];
  const server = createServer((request, response) => {
    if (request.method !== 'POST') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'lane-one' }, { id: 'lane-two' }] }));
      return;
    }
    let text = '';
    request.on('data', (chunk) => (text += String(chunk)));
    request.on('end', () => {
      const body = JSON.parse(text);
      requests.push(body);
      response.setHeader('content-type', 'text/event-stream');
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: `Saved answer from ${body.model}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 } })}\n\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await desktop.page.evaluate(async (port) => {
      const config = (await window.desktop.snapshot()).connections.find(
        (c) => c.id === 'compatible',
      )!;
      await window.desktop.saveConnection({
        ...config,
        endpoint: `http://127.0.0.1:${port}/v1`,
        model: 'lane-one',
        enabled: true,
        configured: true,
      });
    }, port);
    await desktop.page.getByLabel('Message', { exact: true }).fill('A prompt worth comparing');
    await desktop.page.getByRole('button', { name: 'Add context and tools', exact: true }).click();
    await desktop.page.getByRole('button', { name: 'Compare models', exact: true }).click();
    const dialog = desktop.page.getByRole('dialog', { name: 'Compare models', exact: true });
    await dialog.getByLabel('Comparison provider 1', { exact: true }).selectOption('compatible');
    await dialog.getByLabel('Comparison provider 2', { exact: true }).selectOption('compatible');
    await dialog.getByLabel('Comparison model 1', { exact: true }).fill('lane-one');
    await dialog.getByLabel('Comparison model 2', { exact: true }).fill('lane-two');
    await expect(
      dialog.getByText('Each target incurs its own API usage.', { exact: false }),
    ).toBeVisible();
    expect(requests).toHaveLength(0);
    await desktop.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setContentSize(800, 600);
      w.webContents.setZoomFactor(2);
    });
    await expect
      .poll(() => desktop.page.evaluate(() => window.innerWidth))
      .toBeLessThanOrEqual(400);
    const send = dialog.getByRole('button', { name: 'Send to 2 models', exact: true });
    await send.focus();
    await send.press('Enter');
    await expect(dialog.getByText('Saved answer from lane-one', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Saved answer from lane-two', { exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[0].messages).toEqual(requests[1].messages);
    await expect(
      dialog.getByRole('button', { name: 'Continue with this answer', exact: true }),
    ).toHaveCount(2);
    await dialog
      .getByRole('button', { name: 'Continue with this answer', exact: true })
      .nth(1)
      .click();
    await expect(dialog).not.toBeVisible();
    const saved = await desktop.page.evaluate(async () => ({
      groups: await window.desktop.comparisons(),
      snapshot: await window.desktop.snapshot(),
    }));
    expect(saved.groups).toHaveLength(1);
    expect(saved.snapshot.conversations.filter((c) => c.parentConversationId)).toHaveLength(1);
    expect(saved.groups[0].members.every((m) => m.status === 'completed')).toBe(true);
    await desktop.restart();
    const restored = await desktop.page.evaluate(
      (id) => window.desktop.comparison(id),
      saved.groups[0].id,
    );
    expect(restored.members.map((m) => m.text)).toEqual([
      'Saved answer from lane-one',
      'Saved answer from lane-two',
    ]);
    expect(requests).toHaveLength(2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

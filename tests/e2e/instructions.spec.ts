import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, choose } from './fixtures';

async function apiFixture() {
  const requests: { messages: { role: string; content: unknown }[] }[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      if (request.url === '/v1/models') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: [{ id: 'instructions-fixture' }] }));
        return;
      }
      requests.push(JSON.parse(body));
      response.setHeader('content-type', 'text/event-stream');
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Saved answer' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture failed to listen.');
  return {
    requests,
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
async function knowledge(page: Page) {
  await page.getByRole('button', { name: 'Add context and tools', exact: true }).click();
  await page.getByRole('button', { name: 'Project knowledge', exact: true }).click();
  return page.getByRole('dialog', { name: 'Project knowledge', exact: true });
}

test('an empty chat replaces its pending instruction revision before the first request', async ({
  desktop,
}) => {
  const api = await apiFixture();
  const page = desktop.page;
  try {
    await page.evaluate(async (endpoint) => {
      const project = await window.desktop.createChatProject('Empty instruction draft');
      await window.desktop.saveContextItem({
        projectId: project.id,
        kind: 'instructions',
        title: 'Empty rules',
        text: 'EMPTY_OLD_MARKER',
        includeInNewChats: true,
      });
      const connection = (await window.desktop.snapshot()).connections.find(
        (c) => c.id === 'compatible',
      )!;
      await window.desktop.saveConnection({
        ...connection,
        endpoint,
        model: 'instructions-fixture',
        enabled: true,
      });
    }, api.endpoint);
    await page.getByRole('button', { name: 'Empty instruction draft', exact: true }).click();
    await choose(page, 'Provider', 'Compatible API');
    await page.getByLabel('Message', { exact: true }).fill('Unsent first prompt');
    const library = await knowledge(page);
    await library.getByRole('button', { name: 'Edit Empty rules', exact: true }).click();
    await library.getByLabel('Source text', { exact: true }).fill('EMPTY_NEW_MARKER');
    await library.getByRole('button', { name: 'Save source', exact: true }).click();
    await library.getByRole('checkbox', { name: 'Share Empty rules', exact: true }).check();
    await library
      .getByRole('button', { name: 'Add selected sources to conversation', exact: true })
      .click();
    await expect(library).toHaveCount(0);
    await expect(
      page.getByRole('dialog', { name: 'Updated project instructions', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Unsent first prompt');
    expect(api.requests).toHaveLength(0);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => api.requests.length).toBe(1);
    expect(JSON.stringify(api.requests[0]).match(/EMPTY_NEW_MARKER/g)).toHaveLength(1);
    expect(JSON.stringify(api.requests[0])).not.toContain('EMPTY_OLD_MARKER');
    expect(api.requests[0].messages[0].role).toBe('system');
  } finally {
    await api.close();
  }
});

test('updated instructions require a fork, preserve the original draft and reach only the fork request', async ({
  desktop,
}) => {
  const api = await apiFixture();
  const page = desktop.page;
  try {
    await page.evaluate(async (endpoint) => {
      const project = await window.desktop.createChatProject('Instruction revisions');
      await window.desktop.saveContextItem({
        projectId: project.id,
        kind: 'instructions',
        title: 'Editorial rules',
        text: 'OLD_INSTRUCTIONS: use plain language.',
        includeInNewChats: true,
      });
      const connection = (await window.desktop.snapshot()).connections.find(
        (c) => c.id === 'compatible',
      )!;
      await window.desktop.saveConnection({
        ...connection,
        endpoint,
        model: 'instructions-fixture',
        enabled: true,
      });
    }, api.endpoint);
    await page.getByRole('button', { name: 'Instruction revisions', exact: true }).click();
    await choose(page, 'Provider', 'Compatible API');
    await page.getByLabel('Message', { exact: true }).fill('First saved request');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => api.requests.length).toBe(1);
    await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
    const original = await page.evaluate(async () => {
      const conversation = (await window.desktop.snapshot()).conversations.find(
        (c) => c.title === 'First saved request',
      )!;
      return { conversation, messages: await window.desktop.transcript(conversation.id) };
    });
    await page.getByLabel('Message', { exact: true }).fill('Keep this unsent prompt');
    const attachmentPath = join(desktop.data, 'preserved-context.txt');
    await writeFile(attachmentPath, 'Preserved attachment content');
    await desktop.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, attachmentPath);
    await page.getByRole('button', { name: 'Attach files', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'preserved-context.txt', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Context', exact: true }).click();
    const context = page.getByRole('dialog', { name: 'Choose conversation context', exact: true });
    await context.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await context
      .locator('.pdfPages .historyResult')
      .filter({ hasText: 'First saved request' })
      .getByRole('checkbox')
      .check();
    await context.getByRole('button', { name: 'Use selected context', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.desktop.draft(id), original.conversation.id))
            ?.historyMessageIds,
      )
      .toEqual([original.messages[0].id]);
    const before = await page.evaluate((id) => window.desktop.draft(id), original.conversation.id);

    const library = await knowledge(page);
    await library.getByRole('button', { name: 'Edit Editorial rules', exact: true }).click();
    await library
      .getByLabel('Source text', { exact: true })
      .fill('NEW_INSTRUCTIONS: cite source paragraphs.');
    await library.getByRole('button', { name: 'Save source', exact: true }).click();
    await library.getByRole('checkbox', { name: 'Share Editorial rules', exact: true }).check();
    await library
      .getByRole('button', { name: 'Add selected sources to conversation', exact: true })
      .click();
    const update = page.getByRole('dialog', { name: 'Updated project instructions', exact: true });
    await expect(update).toContainText('Editorial rules · revision 1');
    await expect(update).toContainText('Editorial rules · revision 2');
    expect(await page.evaluate((id) => window.desktop.draft(id), original.conversation.id)).toEqual(
      before,
    );
    expect(api.requests).toHaveLength(1);
    await update.getByRole('button', { name: 'Keep captured instructions', exact: true }).click();
    expect(
      await page.evaluate(async () => (await window.desktop.snapshot()).conversations.length),
    ).toBe(1);
    expect(
      await page.evaluate((id) => window.desktop.transcript(id), original.conversation.id),
    ).toEqual(original.messages);

    const again = await knowledge(page);
    await again.getByRole('checkbox', { name: 'Share Editorial rules', exact: true }).check();
    await again
      .getByRole('button', { name: 'Add selected sources to conversation', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Updated project instructions', exact: true })
      .getByRole('button', { name: 'Use updated instructions in a new fork', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Updated project instructions', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Keep this unsent prompt',
    );
    expect(api.requests).toHaveLength(1);
    const branch = await page.evaluate(async (id) => {
      const conversation = (await window.desktop.snapshot()).conversations.find(
        (c) => c.parentConversationId === id,
      )!;
      return {
        conversation,
        draft: await window.desktop.draft(conversation.id),
        messages: await window.desktop.transcript(conversation.id),
      };
    }, original.conversation.id);
    expect(branch.messages.map((m) => m.text)).toEqual(original.messages.map((m) => m.text));
    expect(branch.draft?.historyMessageIds).toEqual([branch.messages[0].id]);
    expect(branch.draft?.attachments).toEqual(before?.attachments);
    expect(branch.draft?.provider).toBe(before?.provider);
    expect(branch.draft?.model).toBe(before?.model);
    expect(await page.evaluate((id) => window.desktop.draft(id), original.conversation.id)).toEqual(
      before,
    );
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => api.requests.length).toBe(2);
    const actual = JSON.stringify(api.requests[1]);
    expect(actual.match(/NEW_INSTRUCTIONS/g)).toHaveLength(1);
    expect(actual).not.toContain('OLD_INSTRUCTIONS');
    expect(actual).toContain('Preserved attachment content');
    expect(actual).toContain('First saved request');
    expect(api.requests[1].messages[0].role).toBe('system');
    expect(
      await page.evaluate((id) => window.desktop.transcript(id), original.conversation.id),
    ).toEqual(original.messages);
  } finally {
    await api.close();
  }
});

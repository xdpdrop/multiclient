import { test, expect, choose } from './fixtures';
import { captureDesktop } from './screenshot';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

async function sendLocal(page: Page, text: string) {
  await choose(page, 'Provider', 'Local test provider');
  await page.getByLabel('Message', { exact: true }).fill(text);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('[data-message-role="user"]').filter({ hasText: text })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
}

test('each conversation retains its own text and attachments across selection and restart', async ({
  desktop,
}) => {
  let page = desktop.page;
  await sendLocal(page, 'Draft A');
  const first = await page.evaluate(
    async () =>
      (await window.desktop.snapshot()).conversations.find(
        (conversation) => conversation.title === 'Draft A',
      )!.id,
  );
  await page.getByLabel('Message', { exact: true }).fill('Draft only A');
  const path = join(desktop.data, 'draft-notes.txt');
  await writeFile(path, 'Unsent attachment');
  await desktop.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, path);
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove draft-notes.txt', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New conversation', exact: false }).click();
  await sendLocal(page, 'Draft B');
  const second = await page.evaluate(
    async () =>
      (await window.desktop.snapshot()).conversations.find(
        (conversation) => conversation.title === 'Draft B',
      )!.id,
  );
  await page.getByLabel('Message', { exact: true }).fill('Draft only B');
  await page.getByRole('button', { name: 'Draft A', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Draft only A');
  await expect(
    page.getByRole('button', { name: 'Remove draft-notes.txt', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Draft B', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Draft only B');
  await expect(
    page.getByRole('button', { name: 'Remove draft-notes.txt', exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((id) => window.desktop.draft(id), second))
    .toMatchObject({ text: 'Draft only B' });
  await desktop.restart();
  page = desktop.page;
  await page.getByRole('button', { name: 'Draft A', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Draft only A');
  await expect(
    page.getByRole('button', { name: 'Remove draft-notes.txt', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate((id) => window.desktop.draft(id), first)).toMatchObject({
    text: 'Draft only A',
    attachments: [{ content: 'Unsent attachment' }],
  });
});

test('message-content search opens its match and archived history can be restored', async ({
  desktop,
}) => {
  const { app, page } = desktop;
  await sendLocal(page, 'History title');
  await sendLocal(page, 'uniqueneedle2026 exists only in this follow-up');
  const source = await page.evaluate(async () => {
    const conversation = (await window.desktop.snapshot()).conversations.find(
      (item) => item.title === 'History title',
    )!;
    return window.desktop.conversation(conversation.id);
  });
  await page.getByRole('button', { name: 'Search conversations', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search conversations', exact: true });
  await search.getByLabel('Search message content', { exact: true }).fill('uniqueneedle2026');
  await expect(search.locator('.historyResult')).toHaveCount(1);
  await captureDesktop(app, 'test-results/history-search.png');
  await search.locator('.historyResult').click();
  await expect(search).toHaveCount(0);
  const match = source.messages.find((message) => message.text.includes('uniqueneedle2026'))!;
  await expect(page.locator(`#message-${match.id}`)).toBeVisible();
  await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Conversation', exact: true });
  await options.getByRole('button', { name: 'Pin conversation', exact: true }).click();
  await expect(
    options.getByRole('button', { name: 'Unpin conversation', exact: true }),
  ).toBeVisible();
  await options.getByRole('button', { name: 'Archive conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'History title', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Archive & backups', exact: true }).click();
  const archive = page.getByRole('dialog', { name: 'Archive & backups', exact: true });
  await expect(
    archive.getByRole('button', { name: 'Restore History title', exact: true }),
  ).toBeVisible();
  await captureDesktop(app, 'test-results/history-archive.png');
  await archive.getByRole('button', { name: 'Restore History title', exact: true }).click();
  await expect(
    archive.getByRole('button', { name: 'Restore History title', exact: true }),
  ).toHaveCount(0);
  await archive.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('button', { name: 'History title', exact: true })).toBeVisible();
});

test('edit and resend creates an immutable fork and excludes later source turns', async ({
  desktop,
}) => {
  const { page } = desktop;
  await sendLocal(page, 'Original prompt');
  await sendLocal(page, 'Later source follow-up');
  const source = await page.evaluate(async () => {
    const conversation = (await window.desktop.snapshot()).conversations.find(
      (item) => item.title === 'Original prompt',
    )!;
    return window.desktop.conversation(conversation.id);
  });
  await page
    .locator('[data-message-role="user"]')
    .first()
    .getByRole('button', { name: 'Edit & resend', exact: true })
    .click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Original prompt');
  await page.getByLabel('Message', { exact: true }).fill('Revised fork prompt');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.locator('[data-message-role="user"]').filter({ hasText: 'Revised fork prompt' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  const outcome = await page.evaluate(async (id) => {
    const original = await window.desktop.conversation(id);
    const child = (await window.desktop.snapshot()).conversations.find(
      (conversation) => conversation.parentConversationId === id,
    )!;
    return { original, branch: await window.desktop.conversation(child.id) };
  }, source.conversation.id);
  expect(outcome.original.messages).toEqual(source.messages);
  expect(
    outcome.branch.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.text),
  ).toEqual(['Revised fork prompt']);
});

test('model filtering supports keyboard selection, empty results and Escape', async ({
  desktop,
}) => {
  const { page } = desktop;
  await choose(page, 'Provider', 'Claude Code');
  const model = page.getByRole('combobox', { name: 'Model', exact: true });
  await model.click();
  const search = page.getByRole('combobox', { name: 'Search model options', exact: true });
  await expect(search).toBeFocused();
  await search.fill('haiku');
  await expect(
    page.getByRole('listbox', { name: 'Model', exact: true }).getByRole('option'),
  ).toHaveCount(1);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(model).toHaveAttribute('data-value', 'haiku');
  await expect(model).toBeFocused();
  await model.click();
  await search.fill('unavailable model fixture');
  await expect(page.getByRole('status').filter({ hasText: 'No matching options.' })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(search).toBeVisible();
  await search.press('Escape');
  await expect(search).not.toBeVisible();
  await expect(model).toBeFocused();
});

test('API setup and local endpoint presets keep the chosen provider and unsent draft', async ({
  desktop,
}) => {
  const { page } = desktop;
  await choose(page, 'Provider', 'OpenAI API');
  await page.getByLabel('Message', { exact: true }).fill('Draft kept during API setup');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Set up a connection', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const openai = settings.getByRole('region', { name: 'OpenAI API connection', exact: true });
  await openai.getByRole('button', { name: 'OpenAI API settings', exact: true }).click();
  await expect(openai.getByLabel('API key', { exact: true })).toHaveAttribute('type', 'password');
  const local = settings.getByRole('region', { name: 'Compatible API connection', exact: true });
  await local.getByRole('button', { name: 'Compatible API settings', exact: true }).click();
  await local
    .getByRole('combobox', { name: /^Local server preset/ })
    .selectOption('http://localhost:11434/v1');
  await local.getByLabel('Default model', { exact: true }).fill('model-fixture');
  await local.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await window.desktop.snapshot()).connections.find(
          (connection) => connection.id === 'compatible',
        ),
      ),
    )
    .toMatchObject({
      endpoint: 'http://localhost:11434/v1',
      model: 'model-fixture',
      configured: false,
    });
  await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toHaveAttribute(
    'data-value',
    'openai',
  );
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Draft kept during API setup',
  );
});

test('saved project defaults fill a blank new context and preserve a nonempty unsent draft', async ({
  desktop,
}) => {
  const { page } = desktop;
  const projectId = await desktop.addProject('defaults project');
  async function saveStarter(text: string) {
    await page.getByRole('button', { name: 'Manage defaults project', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Project settings', exact: true });
    await settings.getByLabel('Reusable starter prompt', { exact: true }).fill(text);
    await settings.getByRole('button', { name: 'Save project defaults', exact: true }).click();
    await expect(settings.getByRole('status').filter({ hasText: 'Defaults saved' })).toBeVisible();
    await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
  await saveStarter('Reusable starter fixture');
  await page.getByRole('button', { name: 'New conversation', exact: false }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Reusable starter fixture');
  await page.getByLabel('Message', { exact: true }).fill('Unsent custom draft');
  await saveStarter('Updated starter fixture');
  await page.getByRole('button', { name: 'New conversation', exact: false }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Unsent custom draft');
  expect(await page.evaluate((id) => window.desktop.projectDefaults(id), projectId)).toMatchObject({
    text: 'Updated starter fixture',
  });
});

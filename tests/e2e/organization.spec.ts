import { test, expect, sendLocal, recordErrors } from './fixtures';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('prompt templates preserve attachments and controls without inference and survive restart', async ({
  desktop,
}) => {
  let page = desktop.page;
  const errors = recordErrors(page);
  await sendLocal(page, 'Template original conversation');
  await page.getByLabel('Message', { exact: true }).fill('Unsent original draft');
  const path = join(desktop.data, 'template-context.txt');
  await writeFile(path, 'Attachment retained while applying a prompt.');
  await desktop.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, path);
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove template-context.txt', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const conversation = (await window.desktop.snapshot()).conversations[0];
        return (await window.desktop.draft(conversation.id))?.attachments.length;
      }),
    )
    .toBe(1);
  const before = await page.evaluate(async () => {
    const conversation = (await window.desktop.snapshot()).conversations[0];
    return {
      id: conversation.id,
      draft: await window.desktop.draft(conversation.id),
      messages: (await window.desktop.transcript(conversation.id)).length,
    };
  });
  await page.getByText('Add context and tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Prompt templates', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Prompt library', exact: true });
  await library.getByRole('button', { name: 'New template', exact: true }).click();
  await library.getByLabel('Template name', { exact: true }).fill('Explain tradeoffs');
  await library
    .getByLabel('Template prompt text', { exact: true })
    .fill('Explain the tradeoffs and give a concrete example.');
  await library.getByRole('button', { name: 'Save template', exact: true }).click();
  await library.getByRole('button', { name: 'Preview application', exact: true }).click();
  await expect(library.getByLabel('Template application preview')).toHaveValue(
    'Unsent original draft\n\nExplain the tradeoffs and give a concrete example.',
  );
  await library.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(library).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Unsent original draft\n\nExplain the tradeoffs and give a concrete example.',
  );
  await expect(
    page.getByRole('button', { name: 'Remove template-context.txt', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate((id) => window.desktop.draft(id), before.id))
    .toMatchObject({
      provider: before.draft!.provider,
      model: before.draft!.model,
      mode: before.draft!.mode,
      effort: before.draft!.effort,
      attachments: before.draft!.attachments,
    });
  expect(await page.evaluate((id) => window.desktop.transcript(id), before.id)).toHaveLength(
    before.messages,
  );
  await desktop.restart();
  page = desktop.page;
  expect(await page.evaluate(() => window.desktop.promptTemplates())).toMatchObject([
    { name: 'Explain tradeoffs' },
  ]);
  await page.getByRole('button', { name: 'Template original conversation', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove template-context.txt', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('conversation tags filter saved history and survive branches and restart', async ({
  desktop,
}) => {
  let page = desktop.page;
  await sendLocal(page, 'Tagged historical answer');
  await page.getByRole('button', { name: 'Conversation options', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Conversation', exact: true })
    .getByRole('button', { name: 'Manage tags', exact: true })
    .click();
  const tags = page.getByRole('dialog', { name: 'Conversation tags', exact: true });
  await tags.getByLabel('New tag', { exact: true }).fill('Research');
  await tags.getByRole('button', { name: 'Create tag', exact: true }).click();
  await expect(tags.getByRole('checkbox', { name: 'Research', exact: true })).toBeChecked();
  await tags.getByRole('button', { name: 'Save conversation tags', exact: true }).click();
  await expect(tags).toHaveCount(0);
  const original = await page.evaluate(async () => {
    const conversation = (await window.desktop.snapshot()).conversations[0];
    const messages = await window.desktop.transcript(conversation.id);
    return {
      id: conversation.id,
      lastMessageId: messages.at(-1)!.id,
      tags: await window.desktop.conversationTags(conversation.id),
    };
  });
  expect(original.tags).toMatchObject([{ name: 'Research' }]);
  const branch = await page.evaluate(
    ({ id, lastMessageId }) => window.desktop.branchConversation(id, lastMessageId),
    original,
  );
  expect(await page.evaluate((id) => window.desktop.conversationTags(id), branch.id)).toEqual(
    original.tags,
  );
  await page.getByRole('button', { name: 'New conversation', exact: false }).click();
  await sendLocal(page, 'Untagged unrelated conversation');
  await page.getByLabel('Filter chats by tag', { exact: true }).selectOption(original.tags[0].id);
  await expect(
    page
      .locator('aside')
      .getByRole('button', { name: 'Untagged unrelated conversation', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('aside').getByRole('button', { name: 'Tagged historical answer', exact: true }),
  ).toBeVisible();
  const results = await page.evaluate(
    (tagId) => window.desktop.search('historical', { tagIds: [tagId] }),
    original.tags[0].id,
  );
  expect(results.length).toBeGreaterThan(0);
  expect(
    results.every(
      (result) => result.conversationId === original.id || result.conversationId === branch.id,
    ),
  ).toBe(true);
  await desktop.restart();
  page = desktop.page;
  expect(await page.evaluate((id) => window.desktop.conversationTags(id), original.id)).toEqual(
    original.tags,
  );
});

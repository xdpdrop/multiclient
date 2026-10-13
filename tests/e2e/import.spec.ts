import { test, expect } from './fixtures';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('native import cancellation and invalid JSON preserve the archive; one explicit valid retry selects durable history', async ({
  desktop,
}) => {
  const { page, app, data } = desktop;
  const invalid = join(data, 'invalid-conversation.json');
  const valid = join(data, 'valid-conversation.json');
  await writeFile(invalid, '{"format":');
  await writeFile(
    valid,
    JSON.stringify({
      format: 'multiclient-conversation',
      version: 1,
      conversation: {
        title: 'Native import retry fixture',
        providerId: 'demo',
        model: '',
        mode: 'chat',
      },
      messages: [
        {
          role: 'user',
          providerId: 'demo',
          text: 'Imported original question',
          status: 'sent',
          createdAt: '2026-10-13T08:00:00.000Z',
        },
        {
          role: 'assistant',
          providerId: 'demo',
          text: 'Imported original answer',
          status: 'completed',
          createdAt: '2026-10-13T08:00:01.000Z',
        },
      ],
    }),
  );
  await app.evaluate(
    ({ dialog }, paths) => {
      (globalThis as any).importPickerCalls = 0;
      dialog.showOpenDialog = async () => {
        const action = ++(globalThis as any).importPickerCalls;
        return action === 1
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [action === 2 ? paths.invalid : paths.valid] };
      };
    },
    { invalid, valid },
  );
  await page.getByRole('button', { name: 'Archive & backups', exact: true }).click();
  const archive = page.getByRole('dialog', { name: 'Archive & backups', exact: true });
  const button = archive.getByRole('button', { name: 'Import conversation JSON', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect.poll(() => app.evaluate(() => (globalThis as any).importPickerCalls)).toBe(1);
  await expect(archive).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(archive.getByRole('alert')).toHaveCount(0);
  expect((await page.evaluate(() => window.desktop.snapshot())).conversations).toHaveLength(0);
  await button.click();
  await expect.poll(() => app.evaluate(() => (globalThis as any).importPickerCalls)).toBe(2);
  await expect(archive.getByRole('alert')).toContainText(/JSON|Unexpected|position|Expected/i);
  await expect(button).toBeEnabled();
  expect((await page.evaluate(() => window.desktop.snapshot())).conversations).toHaveLength(0);
  await button.click();
  await expect.poll(() => app.evaluate(() => (globalThis as any).importPickerCalls)).toBe(3);
  await expect(archive).toHaveCount(0);
  await expect(page.locator('article[data-message-role="user"]')).toContainText(
    'Imported original question',
  );
  await expect(page.locator('article[data-message-role="assistant"]')).toContainText(
    'Imported original answer',
  );
  const saved = await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    return {
      conversation: snapshot.conversations[0],
      activeTurns: snapshot.activeTurns,
      messages: await window.desktop.transcript(snapshot.conversations[0].id),
    };
  });
  expect(saved.conversation.title).toBe('Native import retry fixture');
  expect(saved.messages).toHaveLength(2);
  expect(saved.activeTurns).toHaveLength(0);
  expect(await app.evaluate(() => (globalThis as any).importPickerCalls)).toBe(3);
  await desktop.restart();
  const persisted = await desktop.page.evaluate(
    async (id) => ({
      snapshot: await window.desktop.snapshot(),
      messages: await window.desktop.transcript(id),
    }),
    saved.conversation.id,
  );
  expect(persisted.snapshot.conversations).toHaveLength(1);
  expect(persisted.snapshot.conversations[0].id).toBe(saved.conversation.id);
  expect(persisted.messages).toEqual(saved.messages);
  expect(persisted.snapshot.activeTurns).toHaveLength(0);
});

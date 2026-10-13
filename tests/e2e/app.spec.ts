import { test, expect, choose, recordErrors } from './fixtures';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('sending a local streamed turn preserves attached context across app restart', async ({
  desktop,
}) => {
  let { page } = desktop;
  const { app, data } = desktop;
  const errors = recordErrors(page);
  const contextFile = join(data, 'meeting-notes.txt');
  await writeFile(contextFile, 'The launch is planned for Thursday.');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, contextFile);
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove meeting-notes.txt' })).toBeVisible();
  await choose(page, 'Provider', 'Local test provider');
  await page.getByLabel('Message', { exact: true }).fill('Remember this conversation');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('This is a local test response.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Current project' })).toBeDisabled();
  expect(
    await page.evaluate(async () => {
      const snapshot = await window.desktop.snapshot();
      const view = await window.desktop.conversation(snapshot.conversations[0].id);
      return view.messages[0].context;
    }),
  ).toContain('The launch is planned for Thursday.');
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  await desktop.restart();
  page = desktop.page;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Remember this conversation', exact: true }).click();
  await expect(page.getByText('This is a local test response.')).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const snapshot = await window.desktop.snapshot();
      return (await window.desktop.conversation(snapshot.conversations[0].id)).messages[0].context;
    }),
  ).toContain('The launch is planned for Thursday.');
  expect(errors).toEqual([]);
});

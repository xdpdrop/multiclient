import { test, expect, recordErrors, sendLocal } from './fixtures';

test('Markdown remains inert and progress, tables and activities stay with their messages', async ({
  desktop,
}) => {
  const { page } = desktop;
  const errors = recordErrors(page);
  // Raw HTML and remote images in user-controlled Markdown must remain inert.
  let remoteRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) remoteRequests++;
  });
  await sendLocal(
    page,
    '<img src="https://example.invalid/tracker" onerror="window.injected=true"> ![tracking](https://example.invalid/pixel)',
  );
  expect(remoteRequests).toBe(0);
  expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
  await page.getByLabel('Message', { exact: true }).fill('[blocks] Check the folder');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Here is the result.', { exact: true })).toBeVisible();
  await expect(page.locator('.answerBlock pre code')).toHaveText('const ok = true;\n');
  await expect(page.getByText('Checking the folder.', { exact: true })).not.toBeVisible();
  await page.getByText('Progress update', { exact: true }).click();
  await expect(page.getByText('Checking the folder.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/message-blocks.png' });
  await page.getByLabel('Message', { exact: true }).fill('[table] Compare the hosting options');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.getByText('Compare the options before choosing.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  const tableReply = page
    .locator('article[data-message-role="assistant"]')
    .filter({ has: page.getByRole('table') });
  await expect(tableReply.getByRole('columnheader')).toHaveText(['Option', 'What it means']);
  await expect(tableReply.getByRole('row')).toHaveCount(4);
  await expect(tableReply.locator('pre code')).toHaveText('| literal | pipe |\n');
  const folderReply = page
    .locator('article[data-message-role="assistant"]')
    .filter({ hasText: 'Here is the result.' });
  await folderReply.getByText('1 activity', { exact: true }).click();
  await tableReply.getByText('1 activity', { exact: true }).click();
  await expect(folderReply.getByText('Inspect folder', { exact: true })).toBeVisible();
  await expect(folderReply.getByText('Prepare comparison', { exact: true })).toHaveCount(0);
  await expect(tableReply.getByText('Prepare comparison', { exact: true })).toBeVisible();
  await expect(tableReply.getByText('Inspect folder', { exact: true })).toHaveCount(0);
  const userBubble = await page.locator('article[data-message-role="user"]').last().boundingBox();
  const assistantBubble = await tableReply.boundingBox();
  expect(userBubble!.x).toBeGreaterThan(assistantBubble!.x);
  await page.screenshot({ path: 'test-results/chat-bubbles.png' });
  expect(errors).toEqual([]);
});

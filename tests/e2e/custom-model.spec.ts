import { test, expect, choose } from './fixtures';

test('Enter in the custom model field confirms the model and leaves the draft unsent', async ({
  desktop,
}) => {
  const { page } = desktop;
  const draft = 'Keep this draft when confirming the model';
  await choose(page, 'Provider', 'Local test provider');
  await page.getByLabel('Message', { exact: true }).fill(draft);
  await choose(page, 'Model', 'Custom model…');
  const model = page.getByLabel('Model ID', { exact: true });
  await model.fill('fixture-model-id');
  await model.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveAttribute(
    'data-value',
    'fixture-model-id',
  );
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(draft);
  await expect(page.locator('article[data-message-role="user"]')).toHaveCount(0);
});

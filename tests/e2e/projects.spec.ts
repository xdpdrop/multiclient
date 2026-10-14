import { test, expect, choose, recordErrors, sendLocal } from './fixtures';
import { captureDesktop } from './screenshot';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

test('project trust, project selection and sidebar filters preserve personal history and files', async ({
  desktop,
}) => {
  const { app, page, data } = desktop;
  const errors = recordErrors(page);
  await sendLocal(page, 'Remember this conversation');
  const project = join(data, 'sample project');
  await mkdir(project);
  await writeFile(join(project, 'hello.txt'), 'Hello from an attached file.');
  await app.evaluate(({ dialog }, projectPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [projectPath] });
  }, project);
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add project', exact: true });
  await add
    .getByRole('radio', { name: 'Folder project — files, Git and terminal', exact: true })
    .check();
  await add.getByRole('button', { name: 'Choose folder', exact: true }).click();
  await page.getByRole('button', { name: 'Trust project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Trust project', exact: true })).toHaveCount(0);
  await choose(page, 'Current project', 'Personal space');
  await expect(page.getByRole('combobox', { name: 'Current project' })).toHaveAttribute(
    'data-value',
    '',
  );
  await page.getByRole('combobox', { name: 'Current project' }).click();
  await expect(page.getByRole('listbox', { name: 'Current project' })).toBeVisible();
  await captureDesktop(app, 'test-results/project-picker.png');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Current project' })).toHaveText(
    'sample project',
  );
  await sendLocal(page, 'Project history');
  await page.getByRole('button', { name: 'New conversation', exact: false }).click();
  const sidebar = page.locator('aside');
  await expect(sidebar.getByText('Project chats', { exact: true })).toBeVisible();
  await expect(
    sidebar.getByRole('button', { name: 'Remember this conversation', exact: true }),
  ).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'All conversations', exact: true }).click();
  await expect(sidebar.getByText('Recent chats', { exact: true })).toBeVisible();
  await expect(
    sidebar.getByRole('button', { name: 'Remember this conversation', exact: true }),
  ).toBeVisible();
  await sidebar.getByRole('button', { name: 'sample project', exact: true }).click();
  await expect(
    sidebar.getByRole('button', { name: 'sample project', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const projectActions = sidebar.getByRole('button', { name: 'Manage sample project' });
  await projectActions.focus();
  await expect(projectActions).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Manage sample project' }).click();
  await page.getByRole('button', { name: 'Remove from projects' }).click();
  await expect(page.getByRole('button', { name: 'Manage sample project' })).toHaveCount(0);
  expect(await readFile(join(project, 'hello.txt'), 'utf8')).toBe('Hello from an attached file.');
  expect(errors).toEqual([]);
});

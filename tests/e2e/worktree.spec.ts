import {
  test,
  expect,
  choose,
  submitShellLine,
  waitForShellPrompt,
  waitForTerminalLine,
} from './fixtures';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { childEnvironment, exec, findExecutable } from '../../src/runtime/providers/process';

test('managed worktrees isolate committed files, workspace previews and terminal working directories', async ({
  desktop,
}) => {
  const { page, data } = desktop;
  const projectId = await desktop.addProject('isolated project');
  const source = join(data, 'isolated project');
  const hooks = join(data, 'empty-fixture-hooks');
  await mkdir(hooks);
  const git = await findExecutable('git');
  async function run(args: string[]) {
    await exec(git, ['-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgSign=false', ...args], {
      cwd: source,
      windowsHide: true,
      env: childEnvironment(),
      timeout: 10000,
    });
  }
  await run(['init']);
  await run(['config', 'user.email', 'fixture@example.invalid']);
  await run(['config', 'user.name', 'Fixture']);
  await writeFile(join(source, 'marker.txt'), 'Committed marker');
  await run(['add', 'marker.txt']);
  await run(['commit', '-m', 'Fixture committed reference']);
  await writeFile(join(source, 'marker.txt'), 'Dirty primary marker');
  await page.getByRole('button', { name: 'Manage isolated project', exact: true }).click();
  await page.getByLabel('Starting branch or commit', { exact: true }).fill('HEAD');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Created codex/multiclient-' }),
  ).toBeVisible({ timeout: 15000 });
  const workspace = await page.evaluate(
    async (id) =>
      (await window.desktop.snapshot()).workspaces!.find(
        (workspace) => workspace.projectId === id && workspace.kind === 'worktree',
      )!,
    projectId,
  );
  expect(workspace.path).not.toBe(source);
  expect(await readFile(join(workspace.path, 'marker.txt'), 'utf8')).toBe('Committed marker');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Workspace', exact: true })).toHaveAttribute(
    'data-value',
    workspace.id,
  );
  await page.getByLabel('Workspace tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Toggle files' }).click();
  await page.getByRole('button', { name: 'marker.txt', exact: true }).click();
  await expect(page.locator('.filePreview')).toHaveText('Committed marker');
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.evaluate(() => {
    (window as any).__worktreeTerminalOutput = '';
    window.desktop.onEvent((event) => {
      if (event.type === 'terminal') (window as any).__worktreeTerminalOutput += event.data;
    });
  });
  await page.getByLabel('Workspace tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Toggle terminal' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell' })).toBeVisible();
  await waitForShellPrompt(page, '__worktreeTerminalOutput', workspace.path);
  await submitShellLine(
    page,
    '__worktreeTerminalOutput',
    process.platform === 'win32'
      ? "Write-Output ('WORKTREE_MARKER_' + (Get-Content -LiteralPath './marker.txt'))"
      : 'printf "WORKTREE_MARKER_%s\\n" "$(cat ./marker.txt)"',
  );
  await waitForTerminalLine(page, '__worktreeTerminalOutput', 'WORKTREE_MARKER_Committed marker');
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click();
  await choose(page, 'Workspace', 'Primary checkout');
  await page.getByLabel('Workspace tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Toggle files' }).click();
  await page.getByRole('button', { name: 'marker.txt', exact: true }).click();
  await expect(page.locator('.filePreview')).toHaveText('Dirty primary marker');
  expect(await readFile(join(source, 'marker.txt'), 'utf8')).toBe('Dirty primary marker');
  expect(await readFile(join(workspace.path, 'marker.txt'), 'utf8')).toBe('Committed marker');
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.getByRole('button', { name: 'Manage isolated project', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Project settings', exact: true });
  await settings
    .getByRole('button', { name: 'Archive workspace (preserve files)', exact: true })
    .click();
  await expect(
    settings.getByRole('button', { name: 'Restore workspace', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      async (id) =>
        (await window.desktop.snapshot()).workspaces!.find((workspace) => workspace.id === id)!
          .archived,
      workspace.id,
    ),
  ).toBe(true);
  expect(await readFile(join(workspace.path, 'marker.txt'), 'utf8')).toBe('Committed marker');
  await settings.getByRole('button', { name: 'Restore workspace', exact: true }).click();
  await expect(
    settings.getByRole('status').filter({ hasText: 'Workspace restored' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      async (id) =>
        (await window.desktop.snapshot()).workspaces!.find((workspace) => workspace.id === id)!,
      workspace.id,
    ),
  ).toMatchObject({ archived: false, path: workspace.path, branch: workspace.branch });
  await settings.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await choose(page, 'Workspace', workspace.branch);
  await page.getByLabel('Workspace tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Toggle files' }).click();
  await page.getByRole('button', { name: 'marker.txt', exact: true }).click();
  await expect(page.locator('.filePreview')).toHaveText('Committed marker');
});

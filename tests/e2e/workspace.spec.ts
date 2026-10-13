import { test, expect, choose, waitForShellPrompt } from './fixtures';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('file previews refresh and the context panel overlays at narrow widths', async ({
  desktop,
}) => {
  const { page, app, data } = desktop;
  await desktop.addProject('first project');
  await writeFile(join(data, 'first project', 'notes.txt'), 'Original preview');
  await page.getByLabel('Workspace tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Toggle files' }).click();
  await page.getByRole('button', { name: 'notes.txt', exact: true }).click();
  await expect(page.locator('.filePreview')).toHaveText('Original preview');
  await writeFile(join(data, 'first project', 'notes.txt'), 'Updated preview');
  await page.getByRole('button', { name: 'Refresh panel' }).click();
  await expect(page.locator('.filePreview')).toHaveText('Updated preview');
  await page.getByRole('button', { name: 'Attach this file', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove notes.txt', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const project = (await window.desktop.snapshot()).projects.find(
          (item) => item.name === 'first project',
        )!;
        return window.desktop.draft(`new:${project.workspaceId}`);
      }),
    )
    .toMatchObject({ attachments: [{ path: 'notes.txt', content: 'Updated preview' }] });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(800, 600),
  );
  await expect(page.getByRole('complementary', { name: 'Project context' })).toHaveCSS(
    'position',
    'absolute',
  );
  const panel = await page.getByRole('complementary', { name: 'Project context' }).boundingBox();
  expect(panel!.width).toBeGreaterThan(300);
  await page.screenshot({ path: 'test-results/workspace-panel-narrow.png' });
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
});

test('late directory results cannot replace a newly selected project', async ({ desktop }) => {
  const { page, app } = desktop;
  const firstProject = await desktop.addProject('first project');
  const secondProject = await desktop.addProject('second project');
  const [first, second] = await page.evaluate(
    async ([one, two]) => {
      const snapshot = await window.desktop.snapshot();
      return [one, two].map(
        (id) => snapshot.projects.find((project) => project.id === id)!.workspaceId,
      );
    },
    [firstProject, secondProject],
  );
  await choose(page, 'Current project', 'first project');
  await app.evaluate(({ ipcMain }) => {
    (globalThis as any).__pendingDirectories = [];
    ipcMain.removeHandler('multiclient:files');
    ipcMain.handle(
      'multiclient:files',
      (_event, input) =>
        new Promise((resolve) => {
          (globalThis as any).__pendingDirectories.push({ projectId: input.projectId, resolve });
        }),
    );
  });
  await page.getByLabel('Workspace tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Toggle files' }).click();
  await expect
    .poll(() =>
      app.evaluate(
        (_electron, id) =>
          (globalThis as any).__pendingDirectories.filter((entry: any) => entry.projectId === id)
            .length,
        first,
      ),
    )
    .toBeGreaterThan(0);
  await choose(page, 'Current project', 'second project');
  await expect
    .poll(() =>
      app.evaluate(
        (_electron, id) =>
          (globalThis as any).__pendingDirectories.filter((entry: any) => entry.projectId === id)
            .length,
        second,
      ),
    )
    .toBeGreaterThan(0);
  await app.evaluate((_electron, id) => {
    for (const entry of (globalThis as any).__pendingDirectories.filter(
      (item: any) => item.projectId === id,
    ))
      entry.resolve([{ name: 'second.txt', path: 'second.txt', directory: false }]);
  }, second);
  await expect(page.getByRole('button', { name: 'second.txt', exact: true })).toBeVisible();
  await app.evaluate((_electron, id) => {
    for (const entry of (globalThis as any).__pendingDirectories.filter(
      (item: any) => item.projectId === id,
    ))
      entry.resolve([{ name: 'first.txt', path: 'first.txt', directory: false }]);
  }, first);
  await expect(page.getByRole('button', { name: 'second.txt', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'first.txt', exact: true })).toHaveCount(0);
});

test('Git shows a loading state before reporting per-file staged and unstaged hunks', async ({
  desktop,
}) => {
  const { page, app } = desktop;
  await desktop.addProject('git project');
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('multiclient:git');
    ipcMain.handle(
      'multiclient:git',
      () =>
        new Promise((resolve) => {
          (globalThis as any).__resolveGit = resolve;
        }),
    );
  });
  await page.getByLabel('Workspace tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Toggle Git changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading changes' })).toBeVisible();
  await expect(page.getByText('Working tree is clean.', { exact: true })).toHaveCount(0);
  await app.evaluate(() =>
    (globalThis as any).__resolveGit({
      branch: 'main',
      entries: [{ path: 'file.txt', status: 'MM' }],
      diff: '+staged\n+unstaged',
      files: [
        {
          path: 'file.txt',
          status: 'MM',
          staged: { kind: 'text', text: '@@ -1 +1 @@\n+staged' },
          unstaged: { kind: 'text', text: '@@ -1 +1 @@\n+unstaged' },
        },
      ],
    }),
  );
  await expect(page.getByRole('heading', { name: 'Staged changes', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unstaged changes', exact: true })).toBeVisible();
  await expect(page.locator('.diffAdded')).toHaveText(['+staged\n', '+unstaged\n']);
});

test('hiding or navigating preserves a terminal, and unrelated trust changes do not close it', async ({
  desktop,
}) => {
  const { page } = desktop;
  await desktop.addProject('first project');
  const second = await desktop.addProject('second project');
  await choose(page, 'Current project', 'first project');
  await page.evaluate(() => {
    (window as any).__terminalOutput = '';
    window.desktop.onEvent((event) => {
      if (event.type === 'terminal') (window as any).__terminalOutput += event.data;
    });
  });
  await page.getByLabel('Workspace tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Toggle terminal' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell' })).toBeVisible();
  await waitForShellPrompt(page, '__terminalOutput', join(desktop.data, 'first project'));
  await page.locator('.xterm-screen').click();
  await page.keyboard.type(
    process.platform === 'win32'
      ? "$env:MULTICLIENT_TERMINAL_FIXTURE='SAVED'"
      : 'export MULTICLIENT_TERMINAL_FIXTURE=SAVED',
  );
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Hide terminal' }).click();
  await choose(page, 'Current project', 'second project');
  await page.evaluate((id) => window.desktop.trustProject(id, false), second);
  await choose(page, 'Current project', 'first project');
  await page.getByLabel('Workspace tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Toggle terminal' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell' })).toBeVisible();
  await page.locator('.xterm-screen').click();
  await page.keyboard.type(
    process.platform === 'win32'
      ? "Write-Output ('TOKEN_' + $env:MULTICLIENT_TERMINAL_FIXTURE)"
      : 'printf "TOKEN_%s\\n" "$MULTICLIENT_TERMINAL_FIXTURE"',
  );
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => (window as any).__terminalOutput))
    .toContain('TOKEN_SAVED');
  await desktop.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('multiclient:event', {
      type: 'runtime-state',
      status: 'recovering',
      message: 'Fixture recovery',
    }),
  );
  await expect(page.getByRole('button', { name: 'Restart terminal', exact: true })).toBeVisible();
  await desktop.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send('multiclient:event', {
      type: 'runtime-state',
      status: 'ready',
      message: 'Fixture ready',
    }),
  );
  await expect(
    page.getByRole('status').filter({ hasText: 'Shell stopped during runtime recovery' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Restart terminal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local shell' })).toBeVisible();
  await page.getByRole('button', { name: 'Close terminal' }).click();
  await expect(page.locator('.terminalPanel')).toHaveCount(0);
});

test('questions use native labelled choices and answers provide code copying', async ({
  desktop,
}) => {
  const { page } = desktop;
  await choose(page, 'Provider', 'Local test provider');
  await page.getByLabel('Message', { exact: true }).fill('[question] Choose a direction');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send answer' })).toBeDisabled();
  await page.getByRole('radio', { name: 'First', exact: true }).check();
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await page.getByLabel('Message', { exact: true }).fill('[blocks] Return a code example');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy code' })).toBeVisible();
  const previousClipboard = await desktop.app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await page.getByRole('button', { name: 'Copy code' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
    expect(await desktop.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      'const ok = true;\n',
    );
  } finally {
    await desktop.app.evaluate(
      ({ clipboard }, text) => clipboard.writeText(text),
      previousClipboard,
    );
  }
  await expect(page.locator('.answerBlock pre code')).toHaveText('const ok = true;\n');
});

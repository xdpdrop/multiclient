import { test, expect, _electron as electron } from '@playwright/test';
import { captureDesktop } from './screenshot';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('live Codex Code approval changes a file through the desktop', async ({}, testInfo) => {
  // Standing opt-in. Pull-request CI has no Codex subscription.
  if (process.env.MULTICLIENT_LIVE_DESKTOP !== '1')
    testInfo.skip(true, 'Opt-in subscription test only.');
  test.setTimeout(120000);
  const data = await mkdtemp(join(tmpdir(), 'multiclient-desktop-code-'));
  const project = join(data, 'disposable project');
  await mkdir(project);
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    MULTICLIENT_TEST_MODE: '1',
    MULTICLIENT_TEST_DATA: data,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.MULTICLIENT_PACKAGED_PATH
      ? { executablePath: process.env.MULTICLIENT_PACKAGED_PATH, args: [] }
      : { args: [resolve('out/main/index.js')] }),
    env,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'What’s next?' })).toBeVisible();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, project);
    await page.getByRole('button', { name: 'Add project', exact: true }).click();
    const add = page.getByRole('dialog', { name: 'Add project', exact: true });
    await add
      .getByRole('radio', { name: 'Folder project — files, Git and terminal', exact: true })
      .check();
    await add.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await page.getByRole('button', { name: 'Trust project', exact: true }).click();
    await page.getByRole('combobox', { name: 'Mode', exact: true }).click();
    await page
      .getByRole('listbox', { name: 'Mode', exact: true })
      .getByRole('option', { name: 'Code', exact: true })
      .click();
    await page
      .getByLabel('Message', { exact: true })
      .fill(
        'Create target.txt containing exactly DESKTOP_OK followed by a newline. Use your native file editing tool and request approval. Do not run shell commands or change anything else.',
      );
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible({
      timeout: 80000,
    });
    await expect(readFile(join(project, 'target.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(page.locator('.approvalDetail')).toContainText('target.txt');
    await captureDesktop(app, 'test-results/codex-code-approval.png');
    await page.getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0, {
      timeout: 30000,
    });
    expect(await readFile(join(project, 'target.txt'), 'utf8')).toBe('DESKTOP_OK\n');
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

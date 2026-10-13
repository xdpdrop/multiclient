import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addedProjectId } from './project-path';
import {
  normalizeTerminalBuffer,
  terminalHasLine,
  windowsShellPromptSeen,
} from './terminal-buffer';

export type DesktopFixture = {
  app: ElectronApplication;
  page: Page;
  data: string;
  addProject(name: string): Promise<string>;
  restart(): Promise<void>;
};
export const test = base.extend<{ desktop: DesktopFixture; developmentModes: boolean }>({
  developmentModes: [false, { option: true }],
  desktop: async ({ developmentModes }, use) => {
    const data = await mkdtemp(join(tmpdir(), 'multiclient-focused-e2e-'));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.MULTICLIENT_DEVELOPMENT_MODES;
    if (developmentModes) env.MULTICLIENT_DEVELOPMENT_MODES = '1';
    env.MULTICLIENT_TEST_MODE = '1';
    env.MULTICLIENT_TEST_DATA = data;
    const launch = () =>
      electron.launch({
        ...(process.env.MULTICLIENT_PACKAGED_PATH
          ? { executablePath: process.env.MULTICLIENT_PACKAGED_PATH, args: [] }
          : { args: [resolve('out/main/index.js')] }),
        env,
      });
    let app = await launch();
    try {
      let page = await app.firstWindow();
      await expect(page.getByRole('heading', { name: 'What’s next?' })).toBeVisible();
      await use({
        get app() {
          return app;
        },
        get page() {
          return page;
        },
        data,
        restart: async () => {
          await app.close();
          app = await launch();
          page = await app.firstWindow();
          await expect(page.getByRole('heading', { name: 'What’s next?' })).toBeVisible();
        },
        addProject: async (name) => {
          const path = join(data, name);
          await mkdir(path);
          await app.evaluate(({ dialog }, selected) => {
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
          }, path);
          await page.getByRole('button', { name: 'Add project', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'Add project', exact: true });
          await dialog
            .getByRole('radio', { name: 'Folder project — files, Git and terminal', exact: true })
            .check();
          await dialog.getByRole('button', { name: 'Choose folder', exact: true }).click();
          await expect(dialog).toHaveCount(0);
          const id = await addedProjectId(
            await page.evaluate(async () => (await window.desktop.snapshot()).projects),
            path,
          );
          // Trust is applied in the main process immediately, but the renderer
          // refreshes its snapshot 75ms later. Open the project tools only after
          // that refresh, or Create worktree stays disabled on the stale project.
          const trust = page.getByRole('button', { name: 'Trust project', exact: true });
          await expect(trust).toBeVisible();
          await page.evaluate((projectId) => window.desktop.trustProject(projectId, true), id);
          await expect(trust).toHaveCount(0);
          return id;
        },
      });
    } finally {
      await app.close();
      await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
});
export { expect };
export async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page
    .getByRole('listbox', { name: label, exact: true })
    .getByRole('option', { name: option, exact: true })
    .click();
}

export function recordErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export async function sendLocal(page: Page, text: string) {
  await choose(page, 'Provider', 'Local test provider');
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async (expected) => {
        const snapshot = await window.desktop.snapshot();
        const conversation = snapshot.conversations[0];
        if (!conversation) return false;
        const view = await window.desktop.conversation(conversation.id);
        return (
          view.messages.filter((message) => message.role === 'user').at(-1)?.text === expected &&
          view.messages.at(-1)?.status === 'completed'
        );
      }, text),
    )
    .toBe(true);
  await expect(page.locator('article[data-message-role="user"]').last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
}

function terminalOutput(page: Page, outputKey: string) {
  return page.evaluate((key) => String((window as any)[key] ?? ''), outputKey);
}

export async function waitForShellPrompt(page: Page, outputKey: string, cwd: string) {
  if (process.platform === 'win32') {
    let canonical = cwd;
    try {
      canonical = await realpath(cwd);
    } catch {
      canonical = cwd;
    }
    await expect
      .poll(async () =>
        windowsShellPromptSeen(await terminalOutput(page, outputKey), [cwd, canonical]),
      )
      .toBe(true);
    return;
  }
  await expect
    .poll(async () =>
      /[$#>%]\s*$/.test(normalizeTerminalBuffer(await terminalOutput(page, outputKey))),
    )
    .toBe(true);
}

export async function submitShellLine(page: Page, command: string) {
  await page.locator('.xterm-screen').click();
  await page.keyboard.insertText(command);
  await page.keyboard.press('Enter');
}

export async function waitForTerminalLine(
  page: Page,
  outputKey: string,
  marker: string,
  timeout = 15000,
) {
  await expect
    .poll(async () => terminalHasLine(await terminalOutput(page, outputKey), marker), { timeout })
    .toBe(true);
}

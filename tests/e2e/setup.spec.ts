import { test, expect, choose, recordErrors } from './fixtures';

test('provider keyboard selection and model controls keep their layout and visibility', async ({
  desktop,
}) => {
  const { page } = desktop;
  const errors = recordErrors(page);
  const providerPicker = page.getByRole('combobox', { name: 'Provider', exact: true });
  await providerPicker.focus();
  await page.keyboard.press('ArrowDown');
  const providerMenu = page.getByRole('listbox', { name: 'Provider', exact: true });
  await expect(providerMenu).toBeVisible();
  for (const id of ['codex', 'claude-code', 'cursor'])
    await expect(providerMenu.locator(`[data-provider-logo="${id}"] img:visible`)).toBeVisible();
  await page.screenshot({ path: 'test-results/provider-picker.png' });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(providerPicker).toHaveAttribute('data-value', 'claude-code');
  await providerPicker.click();
  await page.keyboard.press('Escape');
  await expect(providerMenu).not.toBeVisible();
  await expect(providerPicker).toBeFocused();
  await choose(page, 'Provider', 'Codex');
  await expect(
    page.getByRole('combobox', { name: 'Provider', exact: true }).locator('img'),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole('combobox', { name: 'Provider', exact: true })
        .locator('img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByText('Explore a project', { exact: true })).toHaveCount(0);
  const composer = await page.locator('form').boundingBox();
  const main = await page.locator('main').boundingBox();
  expect(Math.abs(composer!.x + composer!.width / 2 - (main!.x + main!.width / 2))).toBeLessThan(2);
  expect(Math.abs(composer!.y + composer!.height / 2 - (main!.y + main!.height / 2))).toBeLessThan(
    100,
  );
  await choose(page, 'Provider', 'Claude Code');
  await choose(page, 'Model', 'Claude Opus');
  await page.getByRole('combobox', { name: 'Model', exact: true }).click();
  await page.screenshot({ path: 'test-results/model-picker.png' });
  await page.keyboard.press('Escape');
  await choose(page, 'Reasoning depth', 'Max');
  await expect(
    page.getByRole('combobox', { name: 'Reasoning depth', exact: true }),
  ).toHaveAttribute('data-value', 'max');
  const controls = await Promise.all(
    ['Provider', 'Model', 'Reasoning depth'].map((label) =>
      page.getByRole('combobox', { name: label, exact: true }).boundingBox(),
    ),
  );
  expect(
    Math.max(...controls.map((box) => box!.y)) - Math.min(...controls.map((box) => box!.y)),
  ).toBeLessThan(2);
  expect(controls.map((box) => box!.height)).toEqual([34, 34, 34]);
  await page.screenshot({ path: 'test-results/welcome.png' });
  await choose(page, 'Model', 'Claude Haiku');
  await expect(page.getByRole('combobox', { name: 'Reasoning depth', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('native titlebar controls stay within the draggable window safe area', async ({ desktop }) => {
  const { page, app } = desktop;
  const errors = recordErrors(page);
  if (process.platform !== 'darwin') {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (navigator as Navigator & { windowControlsOverlay: { visible: boolean } })
              .windowControlsOverlay.visible,
        ),
      )
      .toBe(true);
    const windowBounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { outer: win.getBounds(), content: win.getContentBounds() };
    });
    expect(windowBounds.content.y - windowBounds.outer.y).toBeLessThan(10);
    const safeArea = await page.evaluate(() => {
      const area = (
        navigator as Navigator & { windowControlsOverlay: { getTitlebarAreaRect(): DOMRect } }
      ).windowControlsOverlay.getTitlebarAreaRect();
      return { right: area.x + area.width, height: area.height };
    });
    expect(safeArea.height).toBeGreaterThan(0);
    expect(safeArea.height).toBeLessThanOrEqual(42);
    const header = page.locator('main > header');
    expect(
      await header.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region')),
    ).toBe('drag');
    const controls = await header.locator(':scope > div').last().boundingBox();
    expect(controls!.x + controls!.width).toBeLessThanOrEqual(safeArea.right);
    await expect(
      page.evaluate(() => window.desktop.windowTheme('invalid' as 'light')),
    ).rejects.toThrow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
      )
      .toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
      )
      .toBe(false);
  }
  expect(errors).toEqual([]);
});

test('connection switches and temporary API credentials preserve the selected billing source', async ({
  desktop,
}) => {
  const { page } = desktop;
  const errors = recordErrors(page);
  await page.getByRole('button', { name: 'Settings & connections' }).click();
  const cursorConnection = page.getByRole('region', { name: 'Cursor connection' });
  const cursorSwitch = page.getByRole('switch', { name: 'Enable Cursor', exact: true });
  await expect(cursorSwitch).toBeChecked();
  await cursorSwitch.click();
  await expect(cursorSwitch).not.toBeChecked();
  await expect(cursorConnection.getByRole('status')).toHaveText('Disabled');
  await expect(cursorConnection.getByRole('button', { name: 'Cursor settings' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('combobox', { name: 'Provider', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Cursor', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings & connections' }).click();
  await expect(cursorSwitch).not.toBeChecked();
  await cursorSwitch.focus();
  await page.keyboard.press('Space');
  await expect(cursorSwitch).toBeChecked();
  // Disabling the selected provider never silently changes its billing source.
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'New conversation', exact: false }).click();
  await choose(page, 'Provider', 'Codex');
  await page.getByRole('button', { name: 'Settings & connections' }).click();
  const codexSwitch = page.getByRole('switch', { name: 'Enable Codex', exact: true });
  await codexSwitch.click();
  await expect(codexSwitch).not.toBeChecked();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Disabled connection test');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await expect(
    page.getByText(
      'This connection is disabled. Enable it in Settings or choose another provider.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Settings & connections' }).click();
  await codexSwitch.click();
  await expect(codexSwitch).toBeChecked();
  await expect(page.getByRole('button', { name: 'Refresh connections' })).toBeEnabled({
    timeout: 45000,
  });
  await expect(page.locator('.connectionStatus[data-state="checking"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/connection-switches.png' });
  for (const provider of ['codex', 'claude-code', 'cursor']) {
    const icon = page.locator(`.connectionCard [data-provider-logo="${provider}"] img:visible`);
    await expect(icon).toHaveCount(1);
    await expect
      .poll(() => icon.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
  }
  const selectedProviderBeforeApiSetup = await page
    .locator('[role="combobox"][aria-label="Provider"]')
    .getAttribute('data-value');
  for (const provider of ['openai', 'anthropic', 'compatible'] as const) {
    await expect(page.locator(`.connectionCard [data-provider-logo="${provider}"]`)).toHaveCount(1);
    expect(
      await page.evaluate(async (id) => {
        const connection = (await window.desktop.snapshot()).connections.find((c) => c.id === id)!;
        return connection.enabled;
      }, provider),
    ).toBe(true);
    await page.evaluate(async (id) => {
      const connection = (await window.desktop.snapshot()).connections.find((c) => c.id === id)!;
      await window.desktop.saveConnection({ ...connection, enabled: false });
    }, provider);
    await expect(page.locator('[role="combobox"][aria-label="Provider"]')).toHaveAttribute(
      'data-value',
      selectedProviderBeforeApiSetup!,
    );
    expect(
      await page.evaluate(
        (id) => window.desktop.saveCredential(id, 'unused-test-key', false),
        provider,
      ),
    ).toEqual({ persisted: false });
    await page.evaluate(async (id) => {
      await window.desktop.saveCredential(id, '', false);
      const connection = (await window.desktop.snapshot()).connections.find((c) => c.id === id)!;
      await window.desktop.saveConnection({ ...connection, enabled: true });
    }, provider);
  }
  await page.screenshot({ path: 'test-results/provider-logos.png' });
  expect(errors).toEqual([]);
});

test.describe('explicit development mode controls', () => {
  test.use({ developmentModes: true });
  test('mode and permission changes reset bypass access across new chats and providers', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const errors = recordErrors(page);
    await choose(page, 'Provider', 'Claude Code');
    const modePicker = page.getByRole('combobox', { name: 'Mode', exact: true });
    const permissions = page.getByRole('combobox', { name: 'Permissions', exact: true });
    await expect(modePicker).toHaveText('Chat');
    await expect(permissions).toHaveCount(0);
    await modePicker.click();
    const modeMenu = page.getByRole('listbox', { name: 'Mode', exact: true });
    await expect(modeMenu.getByRole('option')).toHaveCount(4);
    await expect(modeMenu.getByRole('option', { name: /Bypass/ })).toHaveCount(0);
    await expect(modeMenu.getByText('Ask questions and explore files. No changes.')).toBeVisible();
    await page.screenshot({ path: 'test-results/mode-menu.png' });
    await page.keyboard.press('Escape');
    await choose(page, 'Mode', 'Code');
    await expect(permissions).toHaveAttribute('data-value', 'code');
    await choose(page, 'Permissions', 'Bypass approvals');
    await expect(modePicker).toHaveAttribute('data-value', 'code');
    await expect(permissions).toHaveAttribute('data-value', 'code-bypass');
    await expect(page.getByText('Bypass permissions · full access', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/bypass-mode.png' });
    await page.getByRole('button', { name: 'New conversation', exact: false }).click();
    await expect(modePicker).toHaveAttribute('data-value', 'code');
    await expect(permissions).toHaveAttribute('data-value', 'code');
    await expect(page.getByText('Bypass permissions · full access', { exact: true })).toHaveCount(
      0,
    );
    await choose(page, 'Permissions', 'Bypass approvals');
    await modePicker.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(modePicker).toHaveAttribute('data-value', 'plan');
    await expect(permissions).toHaveCount(0);
    await expect(page.getByLabel('Message', { exact: true })).toHaveAttribute(
      'placeholder',
      'What would you like to plan?',
    );
    await choose(page, 'Mode', 'Code');
    await expect(permissions).toHaveAttribute('data-value', 'code');
    // Changing providers must not carry bypass access to the new provider.
    await choose(page, 'Permissions', 'Bypass approvals');
    await choose(page, 'Provider', 'Cursor');
    await expect(modePicker).toHaveAttribute('data-value', 'ask');
    await expect(permissions).toHaveCount(0);
    await choose(page, 'Mode', 'Code');
    await expect(permissions).toHaveAttribute('data-value', 'code');
    await choose(page, 'Provider', 'Codex');
    await expect(modePicker).toHaveAttribute('data-value', 'ask');
    expect(errors).toEqual([]);
  });
});

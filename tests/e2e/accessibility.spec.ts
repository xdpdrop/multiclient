import { test, expect, choose, recordErrors } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { captureDesktop } from './screenshot';

async function tabTo(page: Page, target: Locator) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function expectInsideViewport(target: Locator) {
  const bounds = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      unobscured: !!hit && (element === hit || element.contains(hit)),
    };
  });
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
  expect(bounds.unobscured).toBe(true);
}

test('plain light welcome uses readable foreground contrast', async ({ desktop }) => {
  const { app, page } = desktop;
  await page.evaluate(() => window.desktop.settingsPatch({ appearance: { theme: 'light' } }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const heading = page.getByRole('heading', { name: 'What’s next?' });
  const colors = await heading.evaluate((element) => {
    function luminance(color: string) {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      const linear = channels.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }
    const text = getComputedStyle(element).color;
    const background = getComputedStyle(element.closest('main')!).backgroundColor;
    const levels = [luminance(text), luminance(background)].sort((a, b) => b - a);
    return { text, background, contrast: (levels[0] + 0.05) / (levels[1] + 0.05) };
  });
  expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
  await expectInsideViewport(heading);
  await captureDesktop(app, 'test-results/plain-light-welcome.png');
});

test('200% zoom keeps keyboard navigation, settings and Send inside an 800 by 600 window', async ({
  desktop,
}) => {
  const { app, page } = desktop;
  const errors = recordErrors(page);
  await choose(page, 'Provider', 'Local test provider');
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(800, 600);
    window.webContents.setZoomFactor(2);
  });
  await expect
    .poll(() => page.evaluate(() => innerWidth >= 390 && innerWidth <= 400 && innerHeight <= 300))
    .toBe(true);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(viewport.width).toBeLessThanOrEqual(400);
  expect(viewport.height).toBeLessThanOrEqual(300);
  expect(viewport.width).toBeGreaterThanOrEqual(390);
  await captureDesktop(app, 'test-results/zoom-200-initial.png');
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true });
  await expect(expand).toBeVisible();
  const message = page.getByLabel('Message', { exact: true });
  await tabTo(page, message);
  await expectInsideViewport(message);
  await page.keyboard.type('Keyboard draft at 200% zoom');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await expect(send).toBeEnabled();
  await tabTo(page, send);
  await expectInsideViewport(send);
  await captureDesktop(app, 'test-results/zoom-200-composer.png');

  await tabTo(page, expand);
  await page.keyboard.press('Enter');
  const settings = page.getByRole('button', { name: 'Settings & connections', exact: true });
  await tabTo(page, settings);
  await expectInsideViewport(settings);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  const appearance = dialog.getByRole('button', { name: 'Appearance', exact: true });
  await tabTo(page, appearance);
  await expectInsideViewport(appearance);
  await page.keyboard.press('Enter');
  await captureDesktop(app, 'test-results/zoom-200-settings.png');
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  await tabTo(page, close);
  await expectInsideViewport(close);
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(expand).toBeVisible();
  await tabTo(page, message);
  await expect(message).toHaveValue('Keyboard draft at 200% zoom');
  await tabTo(page, send);
  await expectInsideViewport(send);
  await page.keyboard.press('Enter');
  await expect(page.locator('article[data-message-role="user"]')).toContainText(
    'Keyboard draft at 200% zoom',
  );
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

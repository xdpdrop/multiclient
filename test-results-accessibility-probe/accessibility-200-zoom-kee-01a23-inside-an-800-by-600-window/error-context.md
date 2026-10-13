# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility.spec.ts >> 200% zoom keeps keyboard navigation, settings and Send inside an 800 by 600 window
- Location: tests\e2e\accessibility.spec.ts:61:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Expand sidebar', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: 'Expand sidebar', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: 'Expand sidebar', exact: true })

```

```yaml
- complementary:
  - text: m✳
  - strong: multiclient
  - button "Collapse sidebar"
  - button "New conversation"
  - button "Search conversations"
  - button "Archive & backups"
  - button "All conversations" [pressed]
  - text: Projects
  - button "Add project"
  - text: Recent chats
  - button "Commands Ctrl Shift P"
  - button "Settings & connections"
- main:
  - combobox "Current project": Personal space
  - text: / New conversation
  - heading "What’s next?" [level=1]
  - textbox "Message":
    - /placeholder: Ask anything, or add a file…
  - combobox "Provider": Local test provider
  - combobox "Model": Default model
  - button "Attach files"
  - button "Send message" [disabled]
  - text: Local test · no network
```

# Test source

```ts
  1   | import { test, expect, choose, recordErrors } from './fixtures';
  2   | import type { Locator, Page } from '@playwright/test';
  3   | 
  4   | async function tabTo(page: Page, target: Locator) {
  5   |   for (let attempt = 0; attempt < 80; attempt++) {
  6   |     if (await target.evaluate((element) => element === document.activeElement)) return;
  7   |     await page.keyboard.press('Tab');
  8   |   }
  9   |   await expect(target).toBeFocused();
  10  | }
  11  | 
  12  | async function expectInsideViewport(target: Locator) {
  13  |   const bounds = await target.evaluate((element) => {
  14  |     const box = element.getBoundingClientRect();
  15  |     const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  16  |     return {
  17  |       left: box.left,
  18  |       top: box.top,
  19  |       right: box.right,
  20  |       bottom: box.bottom,
  21  |       width: box.width,
  22  |       height: box.height,
  23  |       viewportWidth: innerWidth,
  24  |       viewportHeight: innerHeight,
  25  |       unobscured: !!hit && (element === hit || element.contains(hit)),
  26  |     };
  27  |   });
  28  |   expect(bounds.width).toBeGreaterThan(0);
  29  |   expect(bounds.height).toBeGreaterThan(0);
  30  |   expect(bounds.left).toBeGreaterThanOrEqual(0);
  31  |   expect(bounds.top).toBeGreaterThanOrEqual(0);
  32  |   expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  33  |   expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
  34  |   expect(bounds.unobscured).toBe(true);
  35  | }
  36  | 
  37  | test('plain light welcome uses readable foreground contrast', async ({ desktop }) => {
  38  |   const { page } = desktop;
  39  |   await page.evaluate(() => window.desktop.settingsPatch({ appearance: { theme: 'light' } }));
  40  |   await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  41  |   const heading = page.getByRole('heading', { name: 'What’s next?' });
  42  |   const colors = await heading.evaluate((element) => {
  43  |     function luminance(color: string) {
  44  |       const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  45  |       const linear = channels.map((value) => {
  46  |         const channel = value / 255;
  47  |         return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  48  |       });
  49  |       return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  50  |     }
  51  |     const text = getComputedStyle(element).color;
  52  |     const background = getComputedStyle(element.closest('main')!).backgroundColor;
  53  |     const levels = [luminance(text), luminance(background)].sort((a, b) => b - a);
  54  |     return { text, background, contrast: (levels[0] + 0.05) / (levels[1] + 0.05) };
  55  |   });
  56  |   expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
  57  |   await expectInsideViewport(heading);
  58  |   await page.screenshot({ path: 'test-results/plain-light-welcome.png' });
  59  | });
  60  | 
  61  | test('200% zoom keeps keyboard navigation, settings and Send inside an 800 by 600 window', async ({
  62  |   desktop,
  63  | }) => {
  64  |   const { app, page } = desktop;
  65  |   const errors = recordErrors(page);
  66  |   await choose(page, 'Provider', 'Local test provider');
  67  |   await app.evaluate(({ BrowserWindow }) => {
  68  |     const window = BrowserWindow.getAllWindows()[0];
  69  |     window.setContentSize(800, 600);
  70  |     window.webContents.setZoomFactor(2);
  71  |   });
  72  |   const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  73  |   expect(viewport.width).toBeLessThanOrEqual(400);
  74  |   expect(viewport.height).toBeLessThanOrEqual(300);
  75  |   expect(viewport.width).toBeGreaterThanOrEqual(390);
  76  |   await page.screenshot({ path: 'test-results/zoom-200-initial.png' });
  77  |   const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true });
> 78  |   await expect(expand).toBeVisible();
      |                        ^ Error: expect(locator).toBeVisible() failed
  79  |   const message = page.getByLabel('Message', { exact: true });
  80  |   await tabTo(page, message);
  81  |   await expectInsideViewport(message);
  82  |   await page.keyboard.type('Keyboard draft at 200% zoom');
  83  |   const send = page.getByRole('button', { name: 'Send message', exact: true });
  84  |   await expect(send).toBeEnabled();
  85  |   await tabTo(page, send);
  86  |   await expectInsideViewport(send);
  87  |   await page.screenshot({ path: 'test-results/zoom-200-composer.png' });
  88  | 
  89  |   await tabTo(page, expand);
  90  |   await page.keyboard.press('Enter');
  91  |   const settings = page.getByRole('button', { name: 'Settings & connections', exact: true });
  92  |   await tabTo(page, settings);
  93  |   await expectInsideViewport(settings);
  94  |   await page.keyboard.press('Enter');
  95  |   const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  96  |   await expect(dialog).toBeVisible();
  97  |   const appearance = dialog.getByRole('button', { name: 'Appearance', exact: true });
  98  |   await tabTo(page, appearance);
  99  |   await expectInsideViewport(appearance);
  100 |   await page.keyboard.press('Enter');
  101 |   await page.screenshot({ path: 'test-results/zoom-200-settings.png' });
  102 |   const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  103 |   await tabTo(page, close);
  104 |   await expectInsideViewport(close);
  105 |   await page.keyboard.press('Enter');
  106 |   await expect(dialog).toHaveCount(0);
  107 |   const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  108 |   await tabTo(page, collapse);
  109 |   await page.keyboard.press('Enter');
  110 |   await expect(expand).toBeVisible();
  111 |   await tabTo(page, message);
  112 |   await expect(message).toHaveValue('Keyboard draft at 200% zoom');
  113 |   await tabTo(page, send);
  114 |   await expectInsideViewport(send);
  115 |   await page.keyboard.press('Enter');
  116 |   await expect(page.locator('article[data-message-role="user"]')).toContainText(
  117 |     'Keyboard draft at 200% zoom',
  118 |   );
  119 |   await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  120 |   await expect(page.locator('[role="alert"]')).toHaveCount(0);
  121 |   expect(errors).toEqual([]);
  122 | });
  123 | 
```
import { test, expect, recordErrors } from './fixtures';
import { captureDesktop } from './screenshot';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

test('theme persists and media backgrounds honor reduced motion', async ({ desktop }) => {
  let { app, page } = desktop;
  const { data } = desktop;
  const errors = recordErrors(page);
  await page.getByRole('button', { name: 'Settings & connections' }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await captureDesktop(app, 'test-results/conversation-dark.png');
  await desktop.restart();
  app = desktop.app;
  page = desktop.page;
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Generated two-color VP8 fixture, licensed with this repository.
  const videoBytes = [...(await readFile(resolve('tests/contracts/fixtures/background.webm')))];
  const video = join(data, 'background.webm');
  expect(videoBytes.length).toBeGreaterThan(100);
  expect(videoBytes.slice(0, 4)).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  await writeFile(video, Buffer.from(videoBytes));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, video);
  await page.getByRole('button', { name: 'Settings & connections' }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Choose background' }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.desktop.snapshot()).settings.appearance.background),
    )
    .not.toBeNull();
  const assetId = await page.evaluate(
    async () => (await window.desktop.snapshot()).settings.appearance.background,
  );
  const delivered = await app.evaluate(async ({ net }, id) => {
    const response = await net.fetch(`media://assets/${id}`);
    return {
      status: response.status,
      mime: response.headers.get('content-type'),
      data: [...new Uint8Array(await response.arrayBuffer())],
    };
  }, assetId);
  expect(delivered.status).toBe(200);
  expect(delivered.mime).toBe('video/webm');
  expect(delivered.data).toEqual(videoBytes);
  await expect.poll(() => page.locator('[role="alert"]').allTextContents()).toEqual([]);
  await expect(page.locator('.background video')).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator('.background video').evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() =>
      page.locator('.background video').evaluate((video: HTMLVideoElement) => video.paused),
    )
    .toBe(false);
  await page.getByLabel('Reduce motion and pause animated backgrounds').check();
  await expect
    .poll(() =>
      page.locator('.background video').evaluate((video: HTMLVideoElement) => video.paused),
    )
    .toBe(true);
  const gif = join(data, 'background.gif');
  await writeFile(
    gif,
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  );
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, gif);
  await page.getByRole('button', { name: 'Choose background' }).click();
  await expect(page.locator('.background img')).toHaveAttribute('src', /^data:image\/png/);
  await expect
    .poll(() =>
      page.locator('.background img').evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1);
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 900;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 1400, 900);
    gradient.addColorStop(0, '#c09064');
    gradient.addColorStop(0.5, '#486c73');
    gradient.addColorStop(1, '#182c42');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1400, 900);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const background = join(data, 'background.png');
  await writeFile(background, Buffer.from(imageData, 'base64'));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, background);
  await page.getByRole('button', { name: 'Choose background' }).click();
  await expect
    .poll(() =>
      page.locator('.background img').evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1400);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect(
    await page.locator('main').evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');
  await captureDesktop(app, 'test-results/background-dark.png');
  await page.getByRole('button', { name: 'Settings & connections' }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await captureDesktop(app, 'test-results/background-light.png');
  expect(
    await page.locator('main > header').evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');
  if (process.env.MULTICLIENT_CAPTURE_FRAME === '1') {
    const frame = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const bounds = win.getBounds();
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: bounds.width, height: bounds.height },
      });
      const source = sources.find((item) => item.id === win.getMediaSourceId());
      if (!source) throw new Error('The preview window could not be captured.');
      return source.thumbnail.toPNG().toString('base64');
    });
    await writeFile('test-results/integrated-window.png', Buffer.from(frame, 'base64'));
  }
  await captureDesktop(app, 'test-results/composer-light.png');
  expect((await page.locator('main > header').boundingBox())!.height).toBe(42);
  expect(await page.locator('aside').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)',
  );
  await page.getByRole('button', { name: 'Settings & connections' }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Remove background' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.background img')).toHaveCount(0);
  expect(errors).toEqual([]);
});

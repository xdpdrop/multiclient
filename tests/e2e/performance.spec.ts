import { test, expect } from './fixtures';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('10,000-message history stays paginated, searchable and anchored while a local turn streams', async ({
  desktop,
}, testInfo) => {
  test.setTimeout(120000);
  const { page, app, data } = desktop;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const marker = 'ancientmarker2026 from the beginning of this saved history';
  const title = 'Ten thousand message history';
  const file = join(data, 'ten-thousand-messages.json');
  await writeFile(
    file,
    JSON.stringify({
      format: 'multiclient-conversation',
      version: 1,
      conversation: { title, providerId: 'demo', model: '', mode: 'chat', effort: '' },
      messages: Array.from({ length: 10000 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        text: index === 42 ? marker : `Fixture message ${index}`,
        providerId: 'demo',
        status: 'completed',
        createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
      })),
      assets: [],
    }),
  );
  await app.evaluate(({ dialog }, path) => {
    (globalThis as any).__performancePickerTimes = [];
    dialog.showOpenDialog = async () => {
      (globalThis as any).__performancePickerTimes.push(Date.now());
      return { canceled: false, filePaths: [path] };
    };
  }, file);
  const articles = page.locator('article[data-message-role]');
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  await page.evaluate(() => {
    const events: { type: string; at: number; disabled: boolean; modalOpen: boolean }[] = [];
    const record = (type: string, target: EventTarget | null) => {
      if (!(target instanceof HTMLElement) || events.length >= 40) return;
      const button = target.closest('button');
      if (button?.textContent?.trim() === 'Import conversation JSON')
        events.push({
          type,
          at: performance.timeOrigin + performance.now(),
          disabled: button.disabled,
          modalOpen: button.closest('dialog')?.open ?? false,
        });
    };
    const pointer = (event: Event) => record(event.type, event.target);
    const types = ['pointerdown', 'pointerup', 'click'];
    types.forEach((type) => document.addEventListener(type, pointer, true));
    const observer = new MutationObserver((records) => {
      for (const mutation of records) record('disabled', mutation.target);
    });
    observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    (window as any).__performanceImportEvents = events;
    (window as any).__stopPerformanceImportRecording = () => {
      observer.disconnect();
      types.forEach((type) => document.removeEventListener(type, pointer, true));
    };
  });
  let importStarted = 0;
  let importFailed = false;
  try {
    await page.getByRole('button', { name: 'Archive & backups', exact: true }).click();
    const archive = page.getByRole('dialog', { name: 'Archive & backups', exact: true });
    importStarted = performance.now();
    await archive.getByRole('button', { name: 'Import conversation JSON', exact: true }).click();
    await expect(archive).toHaveCount(0, { timeout: 30000 });
    await expect(articles).toHaveCount(100, { timeout: 30000 });
  } catch (error) {
    importFailed = true;
    const [picker, renderer] = await Promise.allSettled([
      app.evaluate(() => (globalThis as any).__performancePickerTimes as number[]),
      page.evaluate(() => ({
        events: (window as any).__performanceImportEvents,
        // DOM queries include action errors behind an inert native modal.
        alerts: [...document.querySelectorAll('[role="alert"]')].map(
          (element) => element.textContent ?? '',
        ),
        importDisabled: [...document.querySelectorAll('button')].find(
          (element) => element.textContent?.trim() === 'Import conversation JSON',
        )?.disabled,
      })),
    ]);
    const diagnostic = {
      picker:
        picker.status === 'fulfilled'
          ? { count: picker.value.length, timestamps: picker.value }
          : { unavailable: true },
      renderer: renderer.status === 'fulfilled' ? renderer.value : { unavailable: true },
    };
    const detail = JSON.stringify(diagnostic, null, 2)
      .replaceAll(file, '[fixture file]')
      .replaceAll(data, '[test profile]')
      .replace(/[a-z]:[\\/][^\r\n"<>]+/gi, '[local path]');
    console.log('10,000-message import failure diagnostics:', detail);
    await testInfo
      .attach('import-diagnostics', { body: detail, contentType: 'application/json' })
      .catch(() => console.log('Import diagnostic attachment unavailable.'));
    throw error;
  } finally {
    await page.evaluate(() => (window as any).__stopPerformanceImportRecording()).catch(() => {});
    if (importFailed) {
      const trace = testInfo.outputPath('import-browser-trace.zip');
      await app
        .context()
        .tracing.stop({ path: trace })
        .then(() =>
          testInfo.attach('import-browser-trace', { path: trace, contentType: 'application/zip' }),
        )
        .catch(() => console.log('Import browser trace attachment unavailable.'));
    } else await app.context().tracing.stop();
  }
  const importAndRenderMs = performance.now() - importStarted;
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
  await expect(page.getByText('Fixture message 9999', { exact: true })).toBeVisible();
  const id = await page.evaluate(
    async (name) =>
      (await window.desktop.snapshot()).conversations.find(
        (conversation) => conversation.title === name,
      )!.id,
    title,
  );

  const earlierStarted = performance.now();
  await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
  await expect(articles).toHaveCount(200, { timeout: 30000 });
  const earlierPageMs = performance.now() - earlierStarted;
  await page.getByRole('button', { name: 'Search conversations', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search conversations', exact: true });
  const searchStarted = performance.now();
  await search.getByLabel('Search message content', { exact: true }).fill('ancientmarker2026');
  await expect(search.locator('.historyResult')).toHaveCount(1, { timeout: 30000 });
  const searchToResultMs = performance.now() - searchStarted;
  await search.locator('.historyResult').click();
  await expect(search).toHaveCount(0);
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
  await expect(articles).toHaveCount(100);
  const anchoredIds = await articles.evaluateAll((elements) =>
    elements.map((element) => element.id),
  );
  await page.evaluate(() => window.desktop.settingsPatch({ density: 'compact' }));
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  expect(await articles.evaluateAll((elements) => elements.map((element) => element.id))).toEqual(
    anchoredIds,
  );
  await expect(page.getByText('Fixture message 9999', { exact: true })).toHaveCount(0);

  await page.evaluate((conversationId) => {
    (window as any).__longHistoryEvents = [];
    window.desktop.onEvent((event) => {
      if (
        (event.type === 'conversation' || event.type === 'turn-status') &&
        event.conversationId === conversationId
      )
        (window as any).__longHistoryEvents.push(event);
    });
  }, id);
  const prompt = 'Local streamed turn after ten thousand saved messages';
  await page.getByLabel('Message', { exact: true }).fill(prompt);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  const streamStarted = performance.now();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(
          async ({ conversationId, prompt }) => {
            const view = await window.desktop.conversation(conversationId);
            return (
              view.messages.at(-2)?.text === prompt && view.messages.at(-1)?.status === 'completed'
            );
          },
          { conversationId: id, prompt },
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  const streamCompletionMs = performance.now() - streamStarted;
  await page.evaluate(() => window.desktop.settingsPatch({ density: 'comfortable' }));
  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
  expect(await articles.evaluateAll((elements) => elements.map((element) => element.id))).toEqual(
    anchoredIds,
  );
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).__longHistoryEvents.filter((event: any) => event.type === 'conversation')
          .length,
    ),
  ).toBeGreaterThan(2);

  await page.getByRole('button', { name: 'Jump to latest', exact: true }).click();
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
  await expect(articles).toHaveCount(100);
  const latestIds = await articles.evaluateAll((elements) => elements.map((element) => element.id));
  expect(new Set(latestIds).size).toBe(100);
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      async (conversationId) => (await window.desktop.transcript(conversationId)).length,
      id,
    ),
  ).toBe(10002);
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log('Observed local 10,000-message Electron acceptance timings (ms):', {
    importAndRender: Math.round(importAndRenderMs),
    earlierPage: Math.round(earlierPageMs),
    searchToResult: Math.round(searchToResultMs),
    streamedTurnCompletion: Math.round(streamCompletionMs),
  });
});

import { test, expect, choose } from './fixtures';
import type { ElectronApplication, Page } from '@playwright/test';

async function crashRuntime(app: ElectronApplication, previousPid = 0) {
  return app.evaluate(({ app }, excluded) => {
    const runtime = app
      .getAppMetrics()
      .find(
        (metric) =>
          metric.type === 'Utility' &&
          metric.pid !== excluded &&
          (metric.serviceName === 'Multiclient runtime' || metric.name === 'Multiclient runtime'),
      );
    if (!runtime) throw new Error('The fixture runtime process was not found.');
    process.kill(runtime.pid, 'SIGKILL');
    return runtime.pid;
  }, previousPid);
}

async function savedState(page: Page, id: string) {
  return page.evaluate(async (conversationId) => {
    try {
      const snapshot = await window.desktop.snapshot();
      const view = await window.desktop.conversation(conversationId);
      return {
        conversations: snapshot.conversations.map((conversation) => conversation.id),
        active: snapshot.activeTurns.length,
        messages: view.messages.map((message) => ({
          id: message.id,
          role: message.role,
          status: message.status,
          turnId: message.turnId,
          text: message.text,
        })),
        interactions: view.interactions.length,
      };
    } catch {
      return null;
    }
  }, id);
}

test('real utility-process crashes recover saved turns once, expire questions and never replay a prompt', async ({
  desktop,
}) => {
  const { page, app } = desktop;
  await page.evaluate(() => {
    (window as any).__runtimeStates = [];
    window.desktop.onEvent((event) => {
      if (event.type === 'runtime-state') (window as any).__runtimeStates.push(event.status);
    });
  });
  await choose(page, 'Provider', 'Local test provider');
  await page
    .getByLabel('Message', { exact: true })
    .fill('[question] Await explicit input before continuing');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send answer', exact: true })).toBeVisible({
    timeout: 15000,
  });
  const original = await page.evaluate(async () => {
    const snapshot = await window.desktop.snapshot();
    const conversation = snapshot.conversations[0];
    const view = await window.desktop.conversation(conversation.id);
    return {
      id: conversation.id,
      interactionId: view.interactions[0].id,
      messageIds: view.messages.map((message) => message.id),
      turnIds: [...new Set(view.messages.map((message) => message.turnId))],
    };
  });
  expect(original.messageIds).toHaveLength(2);
  expect(original.turnIds).toHaveLength(1);
  const firstPid = await crashRuntime(app);
  await expect
    .poll(() => savedState(page, original.id), { timeout: 20000 })
    .toMatchObject({
      conversations: [original.id],
      active: 0,
      interactions: 0,
      messages: [
        { role: 'user', status: 'sent' },
        { role: 'assistant', status: 'interrupted', text: '' },
      ],
    });
  await expect(page.locator('.messageStatus strong')).toHaveText('interrupted');
  await expect(page.getByRole('button', { name: 'Send answer', exact: true })).toHaveCount(0);
  const recovered = (await savedState(page, original.id))!;
  expect(recovered.messages.map((message) => message.id)).toEqual(original.messageIds);
  expect([...new Set(recovered.messages.map((message) => message.turnId))]).toEqual(
    original.turnIds,
  );
  expect(await page.evaluate(() => (window as any).__runtimeStates)).toEqual([
    'recovering',
    'ready',
  ]);
  await expect(
    page.evaluate((id) => window.desktop.reply({ id, allow: false }), original.interactionId),
  ).rejects.toThrow(/expired|earlier turn|pending/);

  const secondPid = await crashRuntime(app, firstPid);
  expect(secondPid).not.toBe(firstPid);
  await expect(page.getByRole('button', { name: 'Restart runtime', exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'The local runtime stopped. Your saved work is preserved.' }),
  ).toBeVisible();
  expect((await page.evaluate(() => (window as any).__runtimeStates)).at(-1)).toBe('failed');
  await page.getByRole('button', { name: 'Restart runtime', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restart runtime', exact: true })).toHaveCount(0, {
    timeout: 20000,
  });
  await expect.poll(() => savedState(page, original.id), { timeout: 20000 }).toEqual(recovered);
  expect((await page.evaluate(() => (window as any).__runtimeStates)).at(-1)).toBe('ready');
  await expect(page.locator('.messageStatus strong')).toHaveText('interrupted');
});

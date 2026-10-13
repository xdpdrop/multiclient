const { chromium, expect } = require('@playwright/test');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function launch(executable, data, restored) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  const env = { ...process.env, MULTICLIENT_TEST_MODE: '1', MULTICLIENT_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  // Electron's debugger pipe cannot pass through the self-extracting launcher.
  // Use Chromium's loopback debugging endpoint only in this isolated test process.
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    cwd: data,
    env,
    stdio: 'ignore',
  });
  let stopped = false;
  let launchError;
  child.once('error', (error) => {
    launchError = error;
    stopped = true;
  });
  child.once('exit', () => {
    stopped = true;
  });
  let browser;
  try {
    const deadline = Date.now() + 60000;
    while (!browser && Date.now() < deadline) {
      if (stopped) throw launchError ?? new Error('Portable launcher exited before startup.');
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
      } catch {
        await delay(250);
      }
    }
    if (!browser) throw new Error('Portable app did not start within 60 seconds.');
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 15000 }));
    if (restored) {
      await page.getByRole('button', { name: 'Portable launch check', exact: true }).click();
    } else {
      await page.getByRole('combobox', { name: 'Provider', exact: true }).click();
      await page.getByRole('option', { name: 'Local test provider', exact: true }).click();
      await page.getByLabel('Message', { exact: true }).fill('Portable launch check');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
    }
    await expect(page.getByText('This is a local test response.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
    await page.close();
    const shutdown = Date.now() + 15000;
    while (!stopped && Date.now() < shutdown) await delay(100);
    if (!stopped || child.exitCode !== 0)
      throw new Error('Portable launcher did not exit cleanly.');
  } finally {
    await browser?.close();
    if (!stopped && child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']);
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('The portable EXE test requires Windows.');
  const executable = resolve(process.argv[2] ?? 'release/Multiclient.exe');
  const data = await mkdtemp(join(tmpdir(), 'Multiclient portable ø '));
  try {
    await launch(executable, data, false);
    await launch(executable, data, true);
    console.log('Portable EXE: launch, streaming, persistence, restart and clean exit passed.');
  } finally {
    await rm(data, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

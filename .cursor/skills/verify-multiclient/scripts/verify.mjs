#!/usr/bin/env node
import { _electron as electron } from '@playwright/test';
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');
const evidenceDir = process.argv[3] || '/tmp/multiclient-verify-evidence';
const command = process.argv[2];
const pngSignature = '89504e470d0a1a0a';

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function doctor() {
  const major = process.versions.node.split('.')[0];
  if (major !== '24')
    fail(`Node ${process.versions.node} is running. Multiclient verification uses Node 24.`);
  const main = join(root, 'out/main/index.js');
  const binary = join(root, 'node_modules/electron/dist/electron');
  if (!(await exists(main))) fail(`Missing ${main}. Run npm run build.`);
  if (!(await exists(binary))) fail(`Missing ${binary}. Run npm ci.`);
  if (process.platform === 'linux') {
    const sandbox = join(root, 'node_modules/electron/dist/chrome-sandbox');
    const info = await stat(sandbox);
    if ((info.mode & 0o4000) === 0) fail(`${sandbox} is not setuid. chown root and chmod 4755.`);
  }
  return { ok: true, node: process.versions.node, main, evidenceDir };
}

async function send() {
  await doctor();
  const data = await mkdtemp(join(tmpdir(), 'multiclient-verify-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry) => entry[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.MULTICLIENT_TEST_MODE = '1';
  env.MULTICLIENT_TEST_DATA = data;
  const app = await electron.launch({ args: [join(root, 'out/main/index.js')], env });
  const draft = 'Verify skill send';
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: 'What’s next?' }).waitFor();
    await page.getByRole('combobox', { name: 'Provider', exact: true }).click();
    await page
      .getByRole('listbox', { name: 'Provider', exact: true })
      .getByRole('option', { name: 'Local test provider', exact: true })
      .click();
    await page.getByLabel('Message', { exact: true }).fill(draft);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const article = page.locator('article[data-message-role="user"]').filter({ hasText: draft });
    await article.waitFor();
    const seen = (await article.innerText()).replace(/\s+/g, ' ').trim();
    if (!seen.includes(draft)) fail(`User message did not contain the draft. Saw: ${seen}`);
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
      return image.toPNG().toString('base64');
    });
    const bytes = Buffer.from(png, 'base64');
    if (bytes.subarray(0, 8).toString('hex') !== pngSignature)
      fail('Electron did not return a PNG screenshot.');
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, 'send.png'), bytes);
    await writeFile(
      join(evidenceDir, 'send.json'),
      JSON.stringify({ draft, seen, profile: data, profileRemoved: false }, null, 2),
    );
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  const proof = JSON.parse(await readFile(join(evidenceDir, 'send.json'), 'utf8'));
  proof.profileRemoved = !(await exists(data));
  await writeFile(join(evidenceDir, 'send.json'), JSON.stringify(proof, null, 2));
  if (!proof.profileRemoved) fail(`Profile was not removed: ${data}`);
  console.log(
    JSON.stringify({ ok: true, evidence: evidenceDir, draft: proof.draft, seen: proof.seen }),
  );
}

if (command === 'doctor') console.log(JSON.stringify(await doctor()));
else if (command === 'send') await send();
else fail('Usage: verify.mjs doctor|send [evidence-dir]');

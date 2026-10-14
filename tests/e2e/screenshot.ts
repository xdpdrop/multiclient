import { writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';

const pngSignature = '89504e470d0a1a0a';

/** Electron's CDP Page.captureScreenshot fails intermittently under Xvfb. */
export async function captureDesktop(app: ElectronApplication, path: string) {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
    return image.toPNG().toString('base64');
  });
  const bytes = Buffer.from(png, 'base64');
  if (bytes.subarray(0, 8).toString('hex') !== pngSignature)
    throw new Error('Electron did not return a PNG screenshot.');
  await writeFile(path, bytes);
}

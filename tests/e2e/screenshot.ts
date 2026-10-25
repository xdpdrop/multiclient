import { writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import { after } from '../wait-for';

const pngSignature = '89504e470d0a1a0a';

/**
 * Playwright page.screenshot uses CDP Page.captureScreenshot, which fails
 * intermittently under Xvfb. webContents.capturePage can also throw
 * UnknownVizError until the compositor has a frame, so capture a few times.
 * Nothing exposes frame readiness, so the gap between attempts is a pause.
 */
export async function captureDesktop(app: ElectronApplication, path: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const png = await app.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
        return image.toPNG().toString('base64');
      });
      const bytes = Buffer.from(png, 'base64');
      if (bytes.subarray(0, 8).toString('hex') !== pngSignature)
        throw new Error('Electron did not return a PNG screenshot.');
      await writeFile(path, bytes);
      return;
    } catch (error) {
      lastError = error;
      await after(150);
    }
  }
  throw lastError;
}

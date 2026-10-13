import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { ExtractedPage } from './parser';

export function extractIsolated(
  bytes: Uint8Array,
  mime: string,
  url: string,
  signal: AbortSignal,
  workerPath = join(__dirname, 'research-worker.js'),
): Promise<ExtractedPage> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: { bytes, mime, url },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    });
    const timeout = setTimeout(
      () => finish(new Error('Page extraction exceeded its time limit.')),
      mime === 'application/pdf' ? 15000 : 5000,
    );
    const abort = () => finish(new Error('Web capture cancelled.'));
    let finished = false;
    function finish(error?: Error, result?: ExtractedPage) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      error ? reject(error) : resolve(result!);
    }
    signal.addEventListener('abort', abort, { once: true });
    worker.on('message', (message) =>
      message.error ? finish(new Error(message.error)) : finish(undefined, message.result),
    );
    worker.on('error', () => finish(new Error('The isolated page parser failed.')));
    worker.on('exit', (code) => {
      if (!finished) finish(new Error(`The isolated page parser stopped (${code}).`));
    });
  });
}

import { parentPort, workerData } from 'node:worker_threads';
import { extractPage } from './parser';

extractPage(workerData.bytes, workerData.mime, workerData.url)
  .then((result) => parentPort?.postMessage({ result }))
  .catch(() =>
    parentPort?.postMessage({
      error:
        'The page could not be extracted. It may require sign-in, JavaScript, an unlocked PDF or less content.',
    }),
  );

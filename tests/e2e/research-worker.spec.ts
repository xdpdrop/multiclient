import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures';

test('compiled and packaged research worker extracts HTML and PDF inside Electron utility processes', async ({
  desktop,
}) => {
  const helper = join(desktop.data, 'research-worker-fixture.cjs');
  await writeFile(
    helper,
    `
    const {Worker}=require('node:worker_threads');
    process.parentPort.on('message',({data})=>{
      const worker=new Worker(data.worker,{workerData:{bytes:Buffer.from(data.bytes,'base64'),mime:data.mime,url:'https://example.com/report'},resourceLimits:{maxOldGenerationSizeMb:128}});
      let replied=false;
      worker.on('message',result=>{replied=true;process.parentPort.postMessage({...result,type:process.type});worker.terminate()});
      worker.on('error',error=>{replied=true;process.parentPort.postMessage({error:error.message})});
      worker.on('exit',code=>{if(!replied)process.parentPort.postMessage({error:'Parser worker exited before replying ('+code+').'})});
    });
    process.parentPort.postMessage({ready:true});
  `,
  );
  const appPath = await desktop.app.evaluate(({ app }) => app.getAppPath());
  const worker = process.env.MULTICLIENT_PACKAGED_PATH
    ? join(appPath, 'out', 'main', 'research-worker.js')
    : resolve('out/main/research-worker.js');
  const stream = 'BT /F1 12 Tf 50 750 Td (Saved web PDF) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  for (const input of [
    {
      mime: 'text/html',
      bytes: Buffer.from(
        `<html><head><title>Saved report</title></head><body><article><p>${'The saved web evidence remains inspectable. '.repeat(20)}</p></article><script>throw Error('must not execute')</script></body></html>`,
      ).toString('base64'),
      expected: 'saved web evidence',
    },
    {
      mime: 'application/pdf',
      bytes: Buffer.from(pdf).toString('base64'),
      expected: 'Saved web PDF',
    },
  ]) {
    const result = await desktop.app.evaluate(
      ({ utilityProcess }, data) =>
        new Promise<{
          result?: { text: string };
          error?: string;
          type?: string;
          readyReceived: boolean;
        }>((resolveResult, reject) => {
          const child = utilityProcess.fork(data.helper, [], {
            stdio: 'pipe',
            serviceName: 'Research worker fixture',
          });
          let readyReceived = false;
          let finished = false;
          let stderr = '';
          child.stdout?.resume();
          child.stderr?.on('data', (chunk) => {
            stderr = (stderr + String(chunk)).slice(-8000);
          });
          const fail = (message: string) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            child.kill();
            reject(new Error(`${message} Ready received: ${readyReceived}. ${stderr}`));
          };
          const timeout = setTimeout(() => {
            fail('Research worker fixture timed out.');
          }, 30000);
          child.on('message', (value) => {
            if (finished) return;
            if (value.ready) {
              if (!readyReceived) {
                readyReceived = true;
                child.postMessage({ worker: data.worker, mime: data.mime, bytes: data.bytes });
              }
              return;
            }
            finished = true;
            clearTimeout(timeout);
            child.kill();
            resolveResult({ ...value, readyReceived });
          });
          child.on('exit', (code) => {
            fail(`Research fixture exited before replying (${code}).`);
          });
        }),
      { helper, worker, mime: input.mime, bytes: input.bytes },
    );
    expect(result.error).toBeUndefined();
    expect(result.readyReceived).toBe(true);
    expect(result.type).toBe('utility');
    expect(result.result?.text).toContain(input.expected);
    expect(result.result?.text).not.toContain('must not execute');
  }
});

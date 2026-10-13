const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

function smokeExitDetail(code, signal) {
  if (code === null) return `signal ${signal ?? 'unknown'}`;
  return String(code);
}

function pdf() {
  const stream = 'BT /F1 12 Tf 50 750 Td (Hello captured PDF) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let value = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(value.length);
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = value.length;
  return Buffer.from(
    value +
      `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
}
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-web-worker-'));
  const helper = join(directory, 'utility.cjs');
  const application = join(directory, 'app.cjs');
  try {
    await writeFile(
      helper,
      `
      const {Worker}=require('node:worker_threads');
      process.parentPort.on('message', ({data})=>{
        const worker=new Worker(data.worker,{workerData:{bytes:Buffer.from(data.bytes,'base64'),mime:data.mime,url:'https://example.com/source'},resourceLimits:{maxOldGenerationSizeMb:128}});
        worker.on('message',value=>{process.parentPort.postMessage({...value,mime:data.mime,type:process.type,electron:process.versions.electron});worker.terminate();});
        worker.on('error',error=>process.parentPort.postMessage({error:error.message}));
      });
      process.parentPort.postMessage({ready:true});
    `,
    );
    const html = Buffer.from(
      `<html><head><title>Captured worker report</title></head><body><article><p>${'Useful saved evidence from the isolated reader. '.repeat(20)}</p></article><script>throw Error('must not execute')</script></body></html>`,
    );
    await writeFile(
      application,
      `
      const {app,utilityProcess}=require('electron');
      const assert=require('node:assert/strict');
      app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
      app.whenReady().then(()=>{
        const child=utilityProcess.fork(${JSON.stringify(helper)},[],{stdio:'pipe',serviceName:'Web source parser verification'});
        child.stderr.on('data',data=>process.stderr.write(data));
        const timer=setTimeout(()=>{child.kill();app.exit(1)},30000);
        let count=0;
        child.on('message',value=>{
          try{
            if(value.ready){
              for(const input of ${JSON.stringify([
                { mime: 'text/html', bytes: html.toString('base64') },
                { mime: 'application/pdf', bytes: pdf().toString('base64') },
              ])})child.postMessage({...input,worker:${JSON.stringify(resolve('out/main/research-worker.js'))}});
              return;
            }
            if(value.error)throw Error(value.error);
            assert.equal(value.type,'utility');assert.ok(value.electron);
            if(value.mime==='application/pdf')assert.match(value.result.text,/Hello captured PDF/);
            else{assert.match(value.result.text,/Useful saved evidence/);assert.ok(!value.result.text.includes('must not execute'));}
            if(++count===2){clearTimeout(timer);child.kill();console.log('Compiled Electron utility HTML/PDF worker smoke passed.');app.exit(0);}
          }catch(error){console.error(error);clearTimeout(timer);child.kill();app.exit(1);}
        });
      }).catch(error=>{console.error(error);app.exit(1)});
    `,
    );
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    await new Promise((resolveRun, reject) => {
      const child = spawn(require('electron'), [application], {
        env: environment,
        stdio: 'inherit',
        windowsHide: true,
      });
      child.on('error', reject);
      child.on('exit', (code, signal) =>
        code === 0
          ? resolveRun()
          : reject(new Error(`Web worker smoke failed (${smokeExitDetail(code, signal)}).`)),
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = { smokeExitDetail };

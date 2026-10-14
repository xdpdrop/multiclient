const { spawn, spawnSync } = require('node:child_process');
const { mkdtemp, mkdir, rm, writeFile, readFile, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, basename } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const script = join(__dirname, 'time-startup.ps1');

function killTree(pid) {
  if (!pid) return;
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

async function waitFor(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await stat(path);
      return;
    } catch {
      await delay(20);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function launchOnce(exe, mode) {
  const work = await mkdtemp(join(tmpdir(), 'multiclient-time-'));
  const data = join(work, 'data');
  const ready = join(work, 'ready.txt');
  const start = join(work, 'start.txt');
  const resultPath = join(work, 'result.json');
  await mkdir(data, { recursive: true });
  const monitor = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, resultPath, start, ready],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  let child;
  try {
    await waitFor(ready, 30000);
    const env = { ...process.env, MULTICLIENT_TEST_MODE: '1', MULTICLIENT_TEST_DATA: data };
    delete env.ELECTRON_RUN_AS_NODE;
    const started = Date.now();
    child = spawn(exe, [], { cwd: data, env, stdio: 'ignore' });
    await writeFile(start, `${started}\n${child.pid}\n${mode}\n`, 'ascii');
    await waitFor(resultPath, 560000);
    const measured = JSON.parse(await readFile(resultPath, 'utf8'));
    if (measured.firstWindowMs == null) {
      throw new Error(`No window for ${exe}: ${JSON.stringify(measured)}`);
    }
    console.log(`launch ${mode} ${JSON.stringify(measured)}`);
    return measured;
  } finally {
    killTree(child?.pid);
    killTree(monitor.pid);
    await delay(1000);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(work, { recursive: true, force: true });
        break;
      } catch (error) {
        console.error(`cleanup attempt ${attempt + 1}: ${error.message}`);
        await delay(500);
      }
    }
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Startup timing requires Windows.');
  const input = resolve(process.argv[2] ?? '');
  const output = resolve(process.argv[3] ?? 'timing.json');
  if (!input) throw new Error('Pass a portable EXE or a zip.');
  const artifactBytes = (await stat(input)).size;
  const zip = input.toLowerCase().endsWith('.zip');
  const work = await mkdtemp(join(tmpdir(), 'multiclient-artifact-'));
  try {
    let exe = input;
    let extractMs = null;
    if (zip) {
      const started = Date.now();
      const extracted = spawnSync('tar', ['-xf', input, '-C', work], { stdio: 'inherit' });
      extractMs = Date.now() - started;
      if (extracted.status !== 0) throw new Error(`Could not extract ${input}`);
      exe = join(work, 'Multiclient.exe');
      await stat(exe);
    }
    const runs = [];
    for (let index = 0; index < 2; index += 1) {
      const measured = await launchOnce(exe, zip ? 'direct' : 'portable');
      const launchExtractMs = zip ? (index === 0 ? extractMs : null) : measured.extractMs;
      const firstWindowMs = measured.firstWindowMs;
      const appStartMs =
        zip || launchExtractMs == null
          ? firstWindowMs
          : Math.max(0, firstWindowMs - launchExtractMs);
      runs.push({
        extractMs: launchExtractMs,
        firstWindowMs,
        appStartMs,
        clickToWindowMs: zip && index === 0 ? extractMs + firstWindowMs : firstWindowMs,
        extractedPath: measured.extractedPath,
      });
    }
    const report = {
      artifact: basename(input),
      kind: zip ? 'zip' : 'portable-exe',
      artifactBytes,
      runs,
    };
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

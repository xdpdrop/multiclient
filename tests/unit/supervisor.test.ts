import { describe, expect, it, beforeAll } from 'vitest';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { WindowsJobSupervisor } from '../../src/main/supervisor';

const exec = promisify(execFile);
const binary = resolve('out/main/runtime-supervisor.exe');
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function tree() {
  const runtime = spawn(process.execPath, [resolve('tests/unit/fixtures/process-tree.cjs')], {
    stdio: 'pipe',
    windowsHide: true,
  });
  runtime.stderr.resume();
  const pids: number[] = [];
  let buffer = '';
  runtime.stdout.on('data', (data) => {
    buffer += data.toString();
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      pids.push(JSON.parse(buffer.slice(0, end)).pid);
      buffer = buffer.slice(end + 1);
    }
  });
  const supervisor = new WindowsJobSupervisor(binary);
  try {
    await expect.poll(() => pids.length).toBe(1);
    await supervisor.attach(runtime.pid!);
    runtime.stdin.write('spawn\n');
    await expect.poll(() => pids.length).toBe(3);
    return { runtime, supervisor, pids };
  } catch (error) {
    runtime.kill();
    await supervisor.close();
    throw error;
  }
}

describe.skipIf(process.platform !== 'win32')('Windows kill-on-close job supervision', () => {
  beforeAll(async () => {
    await exec(process.execPath, [resolve('scripts/build-supervisor.cjs')], { windowsHide: true });
  });
  it('kills child and grandchild processes after a forced runtime crash', async () => {
    const { runtime, supervisor, pids } = await tree();
    try {
      runtime.kill();
      await expect.poll(() => alive(pids[0])).toBe(false);
      await supervisor.close();
      await expect.poll(() => pids.every((pid) => !alive(pid))).toBe(true);
    } finally {
      await supervisor.close();
    }
  });
  it('kills the entire tree if the job owner itself terminates', async () => {
    const { supervisor, pids } = await tree();
    try {
      const owner = (supervisor as unknown as { child: ChildProcessWithoutNullStreams }).child;
      owner.kill();
      await expect.poll(() => pids.every((pid) => !alive(pid))).toBe(true);
    } finally {
      await supervisor.close();
    }
  });
  it('fails closed when no supervisor can be started', async () => {
    const supervisor = new WindowsJobSupervisor(resolve('missing-supervisor.exe'));
    await expect(supervisor.attach(process.pid)).rejects.toThrow(/protect the runtime/);
    await supervisor.close();
  });
  it('closes the job when the main owner process crashes and its control pipe closes', async () => {
    const owner = spawn(process.execPath, [resolve('tests/unit/fixtures/job-owner.cjs'), binary], {
      stdio: 'pipe',
      windowsHide: true,
    });
    owner.stderr.resume();
    const pids: number[] = [];
    let buffer = '';
    owner.stdout.on('data', (bytes) => {
      buffer += bytes.toString();
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        pids.push(JSON.parse(buffer.slice(0, end)).pid);
        buffer = buffer.slice(end + 1);
      }
    });
    try {
      await expect.poll(() => pids.length).toBe(5);
      owner.kill();
      await expect.poll(() => pids.every((pid) => !alive(pid))).toBe(true);
    } finally {
      owner.kill();
    }
  });
});

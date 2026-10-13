import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { childEnvironment } from '../runtime/providers/process';

export class WindowsJobSupervisor {
  private child?: ChildProcessWithoutNullStreams;
  private stopping = false;
  constructor(
    private executable: string,
    private failed: () => void = () => {},
    private closeGraceMs = 2000,
  ) {}

  async attach(pid: number): Promise<void> {
    const child = (this.child = spawn(this.executable, [String(pid)], {
      windowsHide: true,
      shell: false,
      stdio: 'pipe',
      env: childEnvironment(),
    }));
    child.stdin.on('error', () => {});
    child.stderr.resume();
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      let output = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Runtime process supervision timed out.'));
      }, 5000);
      const fail = () => {
        clearTimeout(timer);
        if (!ready)
          reject(new Error('Could not protect the runtime process tree. Check the installation.'));
        else if (!this.stopping) this.failed();
      };
      child.on('error', fail);
      child.on('exit', fail);
      child.stdout.on('data', (bytes: Buffer) => {
        output += bytes.toString('utf8');
        if (!ready && output === 'READY\r\n') {
          ready = true;
          clearTimeout(timer);
          resolve();
        } else if (output.length > 4096) {
          child.kill();
          fail();
        }
      });
    });
  }

  async close(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        clearTimeout(giveUp);
        resolve();
      };
      const killTimer = setTimeout(() => child.kill(), this.closeGraceMs);
      const giveUp = setTimeout(finish, this.closeGraceMs + 3000);
      child.once('exit', finish);
      child.stdin.on('error', () => {});
      child.stdin.end();
    });
  }
}

export function terminateProcessGroups(pids: Iterable<number>) {
  for (const pid of pids) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // A process group that has already exited needs no further cleanup.
    }
  }
}

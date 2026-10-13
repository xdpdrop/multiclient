import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { contained } from '../files';
import { promisify } from 'node:util';
import type { ProviderId } from '../../shared/types';
export const exec = promisify(execFile);
const safeNames = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TERM',
  'COLORTERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'SSH_AUTH_SOCK',
];
export function childEnvironment() {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env))
    if (safeNames.includes(key.toUpperCase()) && value !== undefined) env[key] = value;
  return env;
}
export async function findExecutable(
  id: ProviderId | 'git',
  configured = '',
  workspace?: string,
): Promise<string> {
  if (configured) {
    if (!isAbsolute(configured))
      throw new Error('Choose an absolute path to the official executable.');
    await access(configured, constants.X_OK);
    return realpath(configured);
  }
  const name =
    id === 'claude-code' ? 'claude' : id === 'cursor' ? 'agent' : id === 'git' ? 'git' : 'codex';
  const names = process.platform === 'win32' ? [`${name}.exe`] : [name];
  const paths = [
    join(homedir(), '.local', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    ...(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':'),
  ].filter((p) => p && isAbsolute(p) && resolve(p) !== process.cwd());
  for (const dir of paths)
    for (const n of names) {
      const file = join(dir, n);
      try {
        await access(file, constants.X_OK);
        const actual = await realpath(file);
        if (workspace && contained(await realpath(workspace), actual)) continue;
        return actual;
      } catch {
        /* Try the next installation directory. */
      }
    }
  throw new Error(
    `${name} was not found. Install the official CLI or select its executable in Connections.`,
  );
}
const owned = new Set<ChildProcessWithoutNullStreams>();
export type ProcessOwnershipMessage = { type: 'owned-process' | 'release-process'; pid: number };
let supervise: (message: ProcessOwnershipMessage) => void = () => {};
export function setProcessSupervisor(send: (message: ProcessOwnershipMessage) => void) {
  supervise = send;
}
export function registerProcess(pid: number) {
  supervise({ type: 'owned-process', pid });
}
export function releaseProcess(pid: number) {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* The group has already exited. */
    }
  }
  supervise({ type: 'release-process', pid });
}
export function launch(
  executable: string,
  args: string[],
  cwd: string,
  extra: NodeJS.ProcessEnv = {},
) {
  const child = spawn(executable, args, {
    cwd,
    env: { ...childEnvironment(), ...extra },
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: 'pipe',
  });
  if (child.pid) registerProcess(child.pid);
  owned.add(child);
  child.once('exit', () => owned.delete(child));
  child.once('close', () => {
    if (child.pid) releaseProcess(child.pid);
  });
  child.once('error', () => owned.delete(child));
  return child;
}
export async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    try {
      await exec(taskkill, ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        timeout: 5000,
      });
    } catch {
      if (child.exitCode === null) child.kill();
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    await new Promise<void>((r) => {
      const timer = setTimeout(r, 1000);
      child.once('exit', () => {
        clearTimeout(timer);
        r();
      });
    });
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  }
}
export async function stopAll() {
  await Promise.all([...owned].map(stopProcess));
}
export async function version(executable: string) {
  const { stdout } = await exec(executable, ['--version'], {
    env: childEnvironment(),
    cwd: homedir(),
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 16384,
  });
  return stdout.trim().slice(0, 200);
}

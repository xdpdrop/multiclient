import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { childEnvironment, registerProcess, releaseProcess } from '../providers/process';
import type { RuntimeEvent } from '../../shared/types';

export type TerminalInput = 'interactive' | 'script';

const nodeFs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');

/**
 * Primary DA1 report that Windows Terminal sends. conpty.dll 1.23 forwards
 * `ESC [ c` and waits in `WaitUntilDA1` before the client runs. Writing
 * xterm's `ESC [ ? 1 ; 2 c` after that frame was already visible left the
 * client unstarted (run 38565282843, 101 bytes, exit -1). The first parameter
 * is the VT220 conformance level the host records.
 */
export const CONPTY_PRIMARY_DA = '\x1b[?61;4;6;7;14;21;22;23;24;28;32;42c';

export function conptyScriptReply(data: string) {
  let reply = '';
  if (/\x1b\[0?c/.test(data)) reply += CONPTY_PRIMARY_DA;
  if (/\x1b\[>0?c/.test(data)) reply += '\x1b[>0;276;0c';
  if (data.includes('\x1b[6n')) reply += '\x1b[1;1R';
  if (data.includes('\x1b[5n')) reply += '\x1b[0n';
  return reply;
}

function isConptyInputPipe(path: Parameters<typeof nodeFs.openSync>[0], flags: unknown) {
  const mode = typeof flags === 'string' ? flags : '';
  if (mode !== 'w' && mode !== 'w+') return false;
  return /(?:^|[\\/])conpty-[^\\/]+-in$/i.test(String(path));
}

/**
 * node-pty opens `\\.\pipe\conpty-*-in` before `ConnectNamedPipe` and
 * `CreateProcess`. Queue the DA1 report on that fd so the write can land
 * while connect is still inside the native call. Retries cover
 * ERROR_PIPE_LISTENING; one success is enough.
 */
function writeWhenPipeConnects(fd: number, data: Buffer, onExhausted: () => void) {
  const attempt = (remaining: number) => {
    nodeFs.write(fd, data, (error) => {
      if (!error) return;
      if (remaining > 0) attempt(remaining - 1);
      else onExhausted();
    });
  };
  attempt(40);
}

/** Patch the shared `fs` module node-pty uses, only for the duration of `spawn`. */
export function withConptyInputPrefill<T>(
  spawn: () => T,
  hooks?: { onPrefill?: () => void; onExhausted?: () => void },
): T {
  const original = nodeFs.openSync;
  const report = Buffer.from(CONPTY_PRIMARY_DA, 'utf8');
  nodeFs.openSync = ((path, flags, mode) => {
    const fd = original(path, flags, mode);
    if (isConptyInputPipe(path, flags)) {
      hooks?.onPrefill?.();
      writeWhenPipeConnects(fd, report, () => hooks?.onExhausted?.());
    }
    return fd;
  }) as typeof nodeFs.openSync;
  try {
    return spawn();
  } finally {
    nodeFs.openSync = original;
  }
}

function splitTrailingCsi(data: string) {
  const match = /\x1b\[[0-9;?]*$/.exec(data);
  if (!match) return { complete: data, held: '' };
  return { complete: data.slice(0, match.index), held: match[0] };
}

/**
 * `terminal.write` is queued until node-pty marks the pty ready, and that flag
 * stays false while ConPTY is blocked in its device-attributes read. The input
 * pipe is already open, so script mode writes the reply there.
 */
function writePtyInput(terminal: pty.IPty, data: string) {
  const input = (
    terminal as pty.IPty & { _agent?: { inSocket?: { write: (chunk: string) => void } } }
  )._agent?.inSocket;
  if (input) input.write(data);
  else terminal.write(data);
}

/** UTF-16LE base64, the form `powershell.exe -EncodedCommand` accepts. */
export function windowsScriptArgs(command: string) {
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(command, 'utf16le').toString('base64'),
  ];
}

/** `script` is test-only. The app always opens an interactive shell. */
export function terminalShell(input: TerminalInput = 'interactive', command = '') {
  const script = input === 'script';
  if (process.platform === 'win32') {
    return {
      file: join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      args: script ? windowsScriptArgs(command) : ['-NoLogo', '-NoProfile'],
    };
  }
  if (process.platform === 'darwin') {
    return { file: '/bin/zsh', args: script ? ['-f', '+o', 'zle'] : ['-f'] };
  }
  return {
    file: '/bin/bash',
    args: script ? ['--noprofile', '--norc', '--noediting'] : ['--noprofile', '--norc'],
  };
}

export class Terminals {
  private terminals = new Map<string, { terminal: pty.IPty; workspaceId: string }>();
  constructor(private emit: (event: RuntimeEvent) => void) {}
  open(cwd: string, workspaceId = '', input: TerminalInput = 'interactive', command = '') {
    if (this.terminals.size >= 8) throw new Error('Close a terminal before opening another.');
    const shell = terminalShell(input, command);
    const answerConpty = input === 'script' && process.platform === 'win32';
    let prefilled = false;
    let exhausted = false;
    let spawned: pty.IPty | undefined;
    const spawn = () =>
      pty.spawn(shell.file, shell.args, {
        cwd,
        cols: 100,
        rows: 20,
        name: 'xterm-256color',
        env: {
          ...childEnvironment(),
          TERM: 'xterm-256color',
          ...(input === 'script' ? { PS1: '', PS2: '', PROMPT: '', RPROMPT: '' } : {}),
        } as Record<string, string>,
        ...(answerConpty ? { useConptyDll: true } : {}),
      });
    const terminal = answerConpty
      ? withConptyInputPrefill(spawn, {
          onPrefill: () => {
            prefilled = true;
          },
          onExhausted: () => {
            if (spawned) writePtyInput(spawned, CONPTY_PRIMARY_DA);
            else exhausted = true;
          },
        })
      : spawn();
    spawned = terminal;
    if (answerConpty && (!prefilled || exhausted)) writePtyInput(terminal, CONPTY_PRIMARY_DA);
    const id = randomUUID();
    this.terminals.set(id, { terminal, workspaceId });
    registerProcess(terminal.pid);
    let buffer = '';
    let held = '';
    let timer: NodeJS.Timeout | undefined;
    const flush = () => {
      if (buffer) {
        this.emit({ type: 'terminal', terminalId: id, data: buffer });
        buffer = '';
      }
      timer = undefined;
    };
    terminal.onData((data) => {
      if (answerConpty) {
        const split = splitTrailingCsi(held + data);
        held = split.held;
        const reply = conptyScriptReply(split.complete).replaceAll(CONPTY_PRIMARY_DA, '');
        if (reply) writePtyInput(terminal, reply);
      }
      buffer += data;
      if (buffer.length > 1024 * 1024) {
        terminal.kill();
        return;
      }
      timer ??= setTimeout(flush, 16);
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      flush();
      this.terminals.delete(id);
      releaseProcess(terminal.pid);
      this.emit({ type: 'terminal-exit', terminalId: id, code: exitCode });
    });
    return id;
  }
  private get(id: string) {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error('Terminal has closed.');
    return terminal.terminal;
  }
  write(id: string, data: string) {
    this.get(id).write(data);
  }
  resize(id: string, cols: number, rows: number) {
    this.get(id).resize(cols, rows);
  }
  close(id: string) {
    this.terminals.get(id)?.terminal.kill();
    this.terminals.delete(id);
  }
  closeAll() {
    for (const id of this.terminals.keys()) this.close(id);
  }
  closeWorkspace(workspaceId: string) {
    for (const [id, owned] of this.terminals) if (owned.workspaceId === workspaceId) this.close(id);
  }
}

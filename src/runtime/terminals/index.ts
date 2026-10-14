import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { childEnvironment, registerProcess, releaseProcess } from '../providers/process';
import type { RuntimeEvent } from '../../shared/types';

export type TerminalInput = 'interactive' | 'script';

/**
 * Server 2025 ConPTY prints this startup frame, then waits. The DA and cursor
 * queries are not forwarded on the output pipe. xterm answers them; script
 * mode has no xterm, so answer once when the frame arrives.
 * `CSI I` is focus-in for `CSI ? 1004 h`. `CSI ? 1 ; 2 c` is xterm's primary DA.
 * `CSI 1 ; 1 R` is the cursor position.
 */
const CONPTY_STARTUP_REPLY = '\x1b[I\x1b[?1;2c\x1b[1;1R';

/** Replies a headless Windows terminal must write so a ConPTY script can finish. */
export function conptyScriptReply(data: string, state: { startup: boolean }) {
  let reply = '';
  if (!state.startup && (data.includes('\x1b[?9001h') || data.includes('\x1b[?1004h'))) {
    state.startup = true;
    reply += CONPTY_STARTUP_REPLY;
  }
  if (data.includes('\x1b[6n')) reply += '\x1b[1;1R';
  if (data.includes('\x1b[?6n')) reply += '\x1b[?1;1R';
  if (data.includes('\x1b[5n')) reply += '\x1b[0n';
  if (/\x1b\[0?c/.test(data)) reply += '\x1b[?1;2c';
  if (/\x1b\[>0?c/.test(data)) reply += '\x1b[>0;276;0c';
  return reply;
}

function splitTrailingCsi(data: string) {
  const match = /\x1b\[[0-9;?]*$/.exec(data);
  if (!match) return { complete: data, held: '' };
  return { complete: data.slice(0, match.index), held: match[0] };
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
    const terminal = pty.spawn(shell.file, shell.args, {
      cwd,
      cols: 100,
      rows: 20,
      name: 'xterm-256color',
      env: {
        ...childEnvironment(),
        TERM: 'xterm-256color',
        ...(input === 'script' ? { PS1: '', PS2: '', PROMPT: '', RPROMPT: '' } : {}),
      } as Record<string, string>,
    });
    const id = randomUUID();
    this.terminals.set(id, { terminal, workspaceId });
    registerProcess(terminal.pid);
    let buffer = '';
    let held = '';
    const conpty = { startup: false };
    const answerConpty = input === 'script' && process.platform === 'win32';
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
        const reply = conptyScriptReply(split.complete, conpty);
        if (reply) terminal.write(reply);
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

import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { childEnvironment, registerProcess, releaseProcess } from '../providers/process';
import type { RuntimeEvent } from '../../shared/types';

export type TerminalInput = 'interactive' | 'script';

/** `script` is test-only. The app always opens an interactive shell. */
export function terminalShell(input: TerminalInput = 'interactive') {
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
      args: script
        ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-']
        : ['-NoLogo', '-NoProfile'],
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
  open(cwd: string, workspaceId = '', input: TerminalInput = 'interactive') {
    if (this.terminals.size >= 8) throw new Error('Close a terminal before opening another.');
    const shell = terminalShell(input);
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
    let timer: NodeJS.Timeout | undefined;
    const flush = () => {
      if (buffer) {
        this.emit({ type: 'terminal', terminalId: id, data: buffer });
        buffer = '';
      }
      timer = undefined;
    };
    terminal.onData((data) => {
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

import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONPTY_PRIMARY_DA,
  conptyScriptReply,
  terminalShell,
  Terminals,
  windowsScriptArgs,
  withConptyInputPrefill,
} from '../../src/runtime/terminals';

const nodeFs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
const fixture = vi.hoisted(() => ({ terminals: [] as any[], duringSpawn: (): void => {} }));
vi.mock('node-pty', () => ({
  spawn: (file: string, args: string[], options: { cwd?: string; useConptyDll?: boolean }) => {
    fixture.duringSpawn();
    let exit = (_info: { exitCode: number }) => {};
    const terminal = {
      pid: 2000 + fixture.terminals.length,
      file,
      args,
      cwd: options.cwd,
      options,
      kill: vi.fn(() => exit({ exitCode: 0 })),
      write: vi.fn(),
      resize: vi.fn(),
      emitData: (_data: string) => {},
      onData(callback: (data: string) => void) {
        terminal.emitData = callback;
      },
      onExit: (callback: typeof exit) => {
        exit = callback;
      },
    };
    fixture.terminals.push(terminal);
    return terminal;
  },
}));
vi.mock('../../src/runtime/providers/process', () => ({
  childEnvironment: () => ({}),
  registerProcess: vi.fn(),
  releaseProcess: vi.fn(),
}));
afterEach(() => {
  fixture.terminals.length = 0;
  fixture.duringSpawn = () => {};
});

describe('workspace terminal ownership', () => {
  it('closes only the affected workspace and leaves another project usable', () => {
    const terminals = new Terminals(() => {});
    const first = terminals.open('/first', 'first-workspace');
    const second = terminals.open('/second', 'second-workspace');
    terminals.closeWorkspace('second-workspace');
    expect(fixture.terminals[0].kill).not.toHaveBeenCalled();
    expect(fixture.terminals[1].kill).toHaveBeenCalledTimes(1);
    terminals.write(first, 'continue');
    expect(fixture.terminals[0].write).toHaveBeenCalledWith('continue');
    expect(() => terminals.write(second, 'closed')).toThrow(/closed/);
    terminals.closeAll();
    expect(fixture.terminals[0].kill).toHaveBeenCalledTimes(1);
  });

  it('script mode uses the app shell with the line editor disabled', () => {
    const command = 'echo hi';
    const terminals = new Terminals(() => {});
    const shell = terminalShell('script', command);
    terminals.open('/project', 'workspace', 'script', command);
    expect(fixture.terminals[0].file).toBe(shell.file);
    expect(fixture.terminals[0].args).toEqual(shell.args);
    expect(fixture.terminals[0].cwd).toBe('/project');
    expect(terminalShell().args).not.toEqual(shell.args);
    terminals.closeAll();
  });

  it('round-trips a quoted non-ASCII Windows script through EncodedCommand', () => {
    const command = `echo "say 'hi'"\r\nWrite-Output 'café 日本語'`;
    const args = windowsScriptArgs(command);
    expect(args.slice(0, 4)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
    ]);
    expect(Buffer.from(args[4], 'base64').toString('utf16le')).toBe(command);
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const terminals = new Terminals(() => {});
      terminals.open('C:\\project', 'workspace', 'script', command);
      terminals.open('C:\\project', 'workspace');
      expect(fixture.terminals[0].file.endsWith('powershell.exe')).toBe(true);
      expect(fixture.terminals[0].args).toEqual(args);
      expect(fixture.terminals[0].options.useConptyDll).toBe(true);
      expect(fixture.terminals[0].write).toHaveBeenCalledTimes(1);
      expect(fixture.terminals[0].write).toHaveBeenCalledWith(CONPTY_PRIMARY_DA);
      expect(fixture.terminals[1].args).toEqual(['-NoLogo', '-NoProfile']);
      expect(fixture.terminals[1].options.useConptyDll).toBeUndefined();
      expect(fixture.terminals[1].write).not.toHaveBeenCalled();
      expect(terminalShell().args).toEqual(['-NoLogo', '-NoProfile']);
      terminals.closeAll();
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('answers the forwarded device-attributes query only for Windows script mode', () => {
    const frame = '\x1b[1t\x1b[c\x1b[?1004h\x1b[?9001h';
    expect(conptyScriptReply(frame)).toBe(CONPTY_PRIMARY_DA);
    expect(Number(/^\x1b\[\?(\d+)/.exec(CONPTY_PRIMARY_DA)?.[1])).toBeGreaterThanOrEqual(61);
    expect(conptyScriptReply(CONPTY_PRIMARY_DA)).toBe('');
    expect(conptyScriptReply('\x1b[?1;2c')).toBe('');
    expect(conptyScriptReply('\x1b[6n')).toBe('\x1b[1;1R');
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const terminals = new Terminals(() => {});
      terminals.open('C:\\project', 'workspace', 'script', 'echo hi');
      terminals.open('C:\\project', 'workspace');
      const scripted = fixture.terminals[0];
      const interactive = fixture.terminals[1];
      const input = { write: vi.fn() };
      scripted._agent = { inSocket: input };
      expect(scripted.write).toHaveBeenCalledWith(CONPTY_PRIMARY_DA);
      scripted.emitData('\x1b[1');
      expect(input.write).not.toHaveBeenCalled();
      scripted.emitData('t\x1b[c\x1b[?9001h');
      expect(input.write).not.toHaveBeenCalled();
      scripted.emitData('\x1b[6n');
      expect(input.write).toHaveBeenCalledWith('\x1b[1;1R');
      interactive.emitData(frame);
      expect(interactive.write).not.toHaveBeenCalled();
      terminals.closeAll();
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('writes the device-attributes report to the conin pipe before connect', () => {
    const buffers: Buffer[] = [];
    const openSync = vi.spyOn(nodeFs, 'openSync').mockReturnValue(11 as never);
    const write = vi.spyOn(nodeFs, 'write').mockImplementation(((...args: unknown[]) => {
      const buffer = args[1] as Buffer;
      const callback = args.at(-1) as (err: null, written: number, buf: Buffer) => void;
      buffers.push(Buffer.from(buffer));
      callback(null, buffer.length, buffer);
    }) as typeof nodeFs.write);
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    fixture.duringSpawn = () => {
      nodeFs.openSync('\\\\.\\pipe\\conpty-48291.33-in', 'w');
      nodeFs.openSync('\\\\.\\pipe\\conpty-48291.33-out', 'w');
      nodeFs.openSync('notes.txt', 'w');
    };
    try {
      let nested = false;
      withConptyInputPrefill(() => {
        nodeFs.openSync('\\\\.\\pipe\\conpty-48291.33-in', 'w');
        nodeFs.openSync('\\\\.\\pipe\\conpty-1-out', 'w');
        nested = true;
        return 1;
      });
      expect(nested).toBe(true);
      const terminals = new Terminals(() => {});
      terminals.open('C:\\project', 'workspace', 'script', 'echo hi');
      terminals.open('C:\\project', 'workspace');
      expect(buffers.map((entry) => entry.toString('utf8'))).toEqual([
        CONPTY_PRIMARY_DA,
        CONPTY_PRIMARY_DA,
      ]);
      expect(fixture.terminals[0].write).not.toHaveBeenCalled();
      expect(fixture.terminals[1].write).not.toHaveBeenCalled();
      expect(fixture.terminals[1].options.useConptyDll).toBeUndefined();
      terminals.closeAll();
    } finally {
      write.mockRestore();
      openSync.mockRestore();
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });
});

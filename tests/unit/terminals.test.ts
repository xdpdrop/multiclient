import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminalShell, Terminals, windowsScriptArgs } from '../../src/runtime/terminals';

const fixture = vi.hoisted(() => ({ terminals: [] as any[] }));
vi.mock('node-pty', () => ({
  spawn: (file: string, args: string[], options: { cwd?: string }) => {
    let exit = (_info: { exitCode: number }) => {};
    const terminal = {
      pid: 2000 + fixture.terminals.length,
      file,
      args,
      cwd: options.cwd,
      kill: vi.fn(() => exit({ exitCode: 0 })),
      write: vi.fn(),
      resize: vi.fn(),
      onData() {},
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
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    expect(args[3]).toContain(
      ` -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded} < NUL`,
    );
    expect(args[3].startsWith('powershell.exe -')).toBe(false);
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const terminals = new Terminals(() => {});
      terminals.open('C:\\project', 'workspace', 'script', command);
      terminals.open('C:\\project', 'workspace');
      expect(fixture.terminals[0].file.endsWith('cmd.exe')).toBe(true);
      expect(fixture.terminals[0].args).toEqual(args);
      expect(fixture.terminals[0].write).not.toHaveBeenCalled();
      expect(fixture.terminals[1].file.endsWith('powershell.exe')).toBe(true);
      expect(fixture.terminals[1].args).toEqual(['-NoLogo', '-NoProfile']);
      expect(fixture.terminals[1].write).not.toHaveBeenCalled();
      expect(terminalShell().args).toEqual(['-NoLogo', '-NoProfile']);
      terminals.closeAll();
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });
});

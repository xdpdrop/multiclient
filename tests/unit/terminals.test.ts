import { afterEach, describe, expect, it, vi } from 'vitest';
import { Terminals } from '../../src/runtime/terminals';

const fixture = vi.hoisted(() => ({ terminals: [] as any[] }));
vi.mock('node-pty', () => ({
  spawn: () => {
    let exit = (_info: { exitCode: number }) => {};
    const terminal = {
      pid: 2000 + fixture.terminals.length,
      kill: vi.fn(() => exit({ exitCode: 0 })),
      write: vi.fn(),
      resize: vi.fn(),
      onData: vi.fn(),
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
});

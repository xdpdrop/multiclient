import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeHost } from '../../src/main/runtime';

const fixture = vi.hoisted(() => ({ children: [] as any[], fatal: false }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Child extends EventEmitter {
    pid: number | undefined;
    stdout = { resume() {} };
    stderr = { resume() {}, on() {} };
    messages: any[] = [];
    constructor() {
      super();
      this.pid = 1000 + fixture.children.length;
      queueMicrotask(() => this.emit('spawn'));
    }
    postMessage(message: any) {
      this.messages.push(message);
      if (message.type === 'init')
        queueMicrotask(() =>
          this.emit(
            'message',
            fixture.fatal ? { type: 'fatal', error: 'Fixture startup failed' } : { type: 'ready' },
          ),
        );
      if (message.type === 'shutdown') queueMicrotask(() => this.kill());
    }
    kill() {
      if (this.pid) {
        this.pid = undefined;
        this.emit('exit', 1);
      }
      return true;
    }
  }
  return {
    app: { isPackaged: false },
    utilityProcess: {
      fork: () => {
        const child = new Child();
        fixture.children.push(child);
        return child;
      },
    },
  };
});
vi.mock('../../src/main/supervisor', () => ({
  WindowsJobSupervisor: class {
    async attach() {}
    async close() {}
  },
  terminateProcessGroups: vi.fn(),
}));

let host: RuntimeHost | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
  fixture.children.length = 0;
  fixture.fatal = false;
});

describe('bounded runtime recovery', () => {
  it('rejects interrupted requests, recovers once and never replays an operation', async () => {
    host = new RuntimeHost({ dataDir: '', migrations: '', secret: async () => undefined });
    const events: any[] = [];
    host.on('event', (event) => events.push(event));
    await host.start();
    const original = fixture.children[0];
    const pending = host.request('snapshot');
    const rejected = expect(pending).rejects.toThrow(/will not be replayed/);
    original.kill();
    await rejected;
    await expect.poll(() => fixture.children.length).toBe(2);
    await expect.poll(() => events.filter((event) => event.status === 'ready').length).toBe(2);
    expect(
      fixture.children[1].messages.filter((message: any) => message.type === 'request'),
    ).toEqual([]);
    fixture.children[1].kill();
    await expect.poll(() => events.at(-1)?.status).toBe('failed');
    expect(fixture.children.length).toBe(2);
    await expect(host.request('snapshot')).rejects.toThrow(/not ready/);
    await host.restart();
    expect(fixture.children.length).toBe(3);
  });
  it('does not restart after an intentional shutdown', async () => {
    host = new RuntimeHost({ dataDir: '', migrations: '', secret: async () => undefined });
    await host.start();
    await host.stop();
    expect(fixture.children.length).toBe(1);
  });
  it('surfaces startup failure without an automatic restart loop', async () => {
    fixture.fatal = true;
    host = new RuntimeHost({ dataDir: '', migrations: '', secret: async () => undefined });
    await expect(host.start()).rejects.toThrow('Fixture startup failed');
    expect(fixture.children.length).toBe(1);
  });
  it('reports request timing without inputs, paths or raw errors', async () => {
    host = new RuntimeHost({ dataDir: '', migrations: '', secret: async () => undefined });
    const diagnostics: unknown[] = [];
    host.on('diagnostic', (event) => diagnostics.push(event));
    await host.start();
    const result = host.request('snapshot', {
      secret: 'sk-private-key',
      path: 'private-folder',
      prompt: 'private text',
    });
    const child = fixture.children[0];
    const request = child.messages.find((message: any) => message.type === 'request');
    child.emit('message', {
      type: 'response',
      id: request.id,
      result: { value: 'private result' },
    });
    await result;
    expect(diagnostics).toEqual([
      { route: 'snapshot', durationMs: expect.any(Number), outcome: 'completed' },
    ]);
    expect(JSON.stringify(diagnostics)).not.toMatch(/private|prompt|secret|path|value/);
  });
  it('records failures and timeouts without recording provider error text', async () => {
    host = new RuntimeHost({ dataDir: '', migrations: '', secret: async () => undefined });
    const diagnostics: any[] = [];
    host.on('diagnostic', (event) => diagnostics.push(event));
    await host.start();
    const failed = host.request('snapshot');
    const rejected = expect(failed).rejects.toThrow('private provider error');
    const child = fixture.children[0];
    const request = child.messages.find((message: any) => message.type === 'request');
    child.emit('message', { type: 'response', id: request.id, error: 'private provider error' });
    await rejected;
    vi.useFakeTimers();
    try {
      const timeout = host.request('snapshot');
      const timedOut = expect(timeout).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(60000);
      await timedOut;
      expect(diagnostics.map((event) => event.outcome)).toEqual(['failed', 'timeout']);
      expect(JSON.stringify(diagnostics)).not.toContain('private');
    } finally {
      vi.useRealTimers();
    }
  });
});

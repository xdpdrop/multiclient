import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { NdjsonDecoder } from './ndjson';
export class Rpc extends EventEmitter {
  private serial = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }
  >();
  private dead = false;
  constructor(readonly child: ChildProcessWithoutNullStreams) {
    super();
    const parser = new NdjsonDecoder((value) => this.receive(value));
    child.stdout.on('data', (data) => {
      try {
        parser.push(data);
      } catch (e) {
        this.fail(e instanceof Error ? e : new Error(String(e)));
        child.kill();
      }
    });
    child.on('error', (e) => this.fail(e));
    child.on('exit', (code, signal) =>
      this.fail(new Error(`Provider process exited (${signal ?? code}).`)),
    );
    child.stdin.on('error', (e) => this.fail(e));
    // Never persist stderr: it can contain credentials or local configuration.
    child.stderr.resume();
  }
  private receive(value: any) {
    if (!value || typeof value !== 'object') throw new Error('Invalid provider protocol message.');
    if (value.method) {
      this.emit(value.id === undefined ? 'notification' : 'request', value);
      return;
    }
    const item = this.pending.get(value.id);
    if (!item) return;
    this.pending.delete(value.id);
    clearTimeout(item.timer);
    if (value.error)
      item.reject(new Error(value.error.message || 'Provider rejected the request.'));
    else item.resolve(value.result);
  }
  private write(value: unknown) {
    if (this.dead) throw new Error('Provider disconnected.');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  request(method: string, params: unknown, timeout = 30000): Promise<any> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`Provider timed out: ${method}`));
          }, timeout)
        : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }
  notify(method: string, params?: unknown) {
    this.write({ jsonrpc: '2.0', method, params });
  }
  respond(id: number | string, result: unknown) {
    this.write({ jsonrpc: '2.0', id, result });
  }
  reject(id: number | string, message = 'Unsupported client request') {
    this.write({ jsonrpc: '2.0', id, error: { code: -32601, message } });
  }
  private fail(error: Error) {
    if (this.dead) return;
    this.dead = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit('disconnect', error);
  }
  close() {
    this.fail(new Error('Provider connection closed.'));
    this.child.stdin.end();
  }
}

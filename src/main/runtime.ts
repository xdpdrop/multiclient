import { app, utilityProcess, type UtilityProcess } from 'electron';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { routes, type Route } from '../shared/schema';
import type { CredentialId } from '../shared/types';
import { childEnvironment } from '../runtime/providers/process';
import { WindowsJobSupervisor, terminateProcessGroups } from './supervisor';

export class RuntimeHost extends EventEmitter {
  private child?: UtilityProcess;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private ready = false;
  private stopping = false;
  private automaticRestarts = 0;
  private stopGeneration = 0;
  private starting?: Promise<void>;
  private supervisor?: WindowsJobSupervisor;
  constructor(
    private options: {
      dataDir: string;
      migrations: string;
      secret: (id: CredentialId) => Promise<string | undefined>;
      supervisorExecutable?: string;
    },
  ) {
    super();
  }

  start(): Promise<void> {
    if (this.ready) return Promise.resolve();
    this.stopping = false;
    this.starting ??= this.launch().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async launch() {
    const env = Object.fromEntries(
      Object.entries(childEnvironment()).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    for (const name of ['MULTICLIENT_TEST_MODE', 'MULTICLIENT_DEVELOPMENT_MODES'])
      if (process.env[name] === '1') env[name] = '1';
    const child = (this.child = utilityProcess.fork(join(__dirname, 'runtime.js'), [], {
      serviceName: 'Multiclient runtime',
      stdio: 'pipe',
      env,
    }));
    const groups = new Set<number>();
    let supervisor: WindowsJobSupervisor | undefined;
    let initialized = false;
    let rejectStartup: (error: Error) => void = () => {};
    child.stdout?.resume();
    if (process.env.MULTICLIENT_TEST_MODE === '1')
      child.stderr?.on('data', (data) => process.stderr.write(data));
    else child.stderr?.resume();
    child.on('message', async (message) => {
      if (this.child !== child) return;
      if (message.type === 'response') {
        const p = this.pending.get(message.id);
        if (!p) return;
        this.pending.delete(message.id);
        clearTimeout(p.timer);
        message.error ? p.reject(new Error(message.error)) : p.resolve(message.result);
      }
      if (message.type === 'event') this.emit('event', message.event);
      if (message.type === 'owned-process' && Number.isSafeInteger(message.pid) && message.pid > 0)
        groups.add(message.pid);
      if (message.type === 'release-process') groups.delete(message.pid);
      if (message.type === 'secret') {
        let value: string | undefined;
        try {
          value = await this.options.secret(message.providerId);
        } catch {
          /* The adapter reports unavailable credentials. */
        }
        if (this.child === child && child.pid)
          child.postMessage({ type: 'secret', requestId: message.requestId, value });
      }
    });
    child.once('exit', () => {
      const generation = this.stopGeneration;
      const current = this.child === child;
      const recover = initialized && !this.stopping && current;
      if (current) {
        this.ready = false;
        this.child = undefined;
      }
      rejectStartup(new Error('The local runtime stopped during startup.'));
      if (current)
        this.rejectPending(
          new Error(
            'The local runtime stopped. The operation was interrupted and will not be replayed.',
          ),
        );
      void (async () => {
        if (supervisor) await supervisor.close();
        if (process.platform !== 'win32') terminateProcessGroups(groups);
        if (!recover || this.stopping || generation !== this.stopGeneration) return;
        if (this.automaticRestarts++ === 0) {
          this.emit('event', {
            type: 'runtime-state',
            status: 'recovering',
            message: 'Recovering the local runtime. Interrupted operations will not be replayed.',
          });
          try {
            await this.starting?.catch(() => {});
            if (this.stopping || generation !== this.stopGeneration) return;
            await this.start();
          } catch {
            this.failed();
          }
        } else this.failed();
      })();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        rejectStartup = reject;
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error('Runtime startup timed out.'));
        }, 15000);
        const message = (value: any) => {
          if (this.child !== child) return;
          if (value.type === 'ready') {
            clearTimeout(timeout);
            initialized = true;
            this.ready = true;
            this.emit('event', {
              type: 'runtime-state',
              status: 'ready',
              message: 'The local runtime is ready.',
            });
            resolve();
          }
          if (value.type === 'fatal') {
            clearTimeout(timeout);
            reject(new Error(value.error));
          }
        };
        child.on('message', message);
        child.once('exit', () => {
          clearTimeout(timeout);
          child.off('message', message);
        });
        child.once('spawn', () => {
          void (async () => {
            if (process.platform === 'win32') {
              supervisor = new WindowsJobSupervisor(
                this.options.supervisorExecutable ??
                  join(
                    app.isPackaged ? process.resourcesPath : __dirname,
                    'runtime-supervisor.exe',
                  ),
                () => child.kill(),
              );
              this.supervisor = supervisor;
              await supervisor.attach(child.pid!);
            }
            if (this.child !== child || this.stopping || !child.pid)
              throw new Error('Runtime startup was cancelled.');
            child.postMessage({
              type: 'init',
              dataDir: this.options.dataDir,
              migrations: this.options.migrations,
              bridgePath: join(__dirname, 'claude-bridge.js'),
            });
          })().catch((error) => {
            clearTimeout(timeout);
            child.kill();
            reject(error);
          });
        });
      });
    } catch (error) {
      child.kill();
      await supervisor?.close();
      throw error;
    }
  }

  private failed() {
    this.emit('event', {
      type: 'runtime-state',
      status: 'failed',
      message: 'The local runtime stopped. Restart the runtime to recover saved conversations.',
    });
  }
  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  request(route: Route, input: unknown = {}): Promise<any> {
    const started = performance.now();
    const diagnostic = (outcome: 'completed' | 'failed' | 'timeout') =>
      this.emit('diagnostic', {
        route: Object.prototype.hasOwnProperty.call(routes, route) ? route : 'unknown',
        durationMs: Math.round(performance.now() - started),
        outcome,
      });
    if (!this.ready || !this.child) {
      diagnostic('failed');
      return Promise.reject(
        new Error('Local runtime is not ready. Restart the runtime if recovery fails.'),
      );
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const completed = (value: unknown) => {
        diagnostic('completed');
        resolve(value);
      };
      const failed = (error: Error) => {
        diagnostic('failed');
        reject(error);
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        diagnostic('timeout');
        reject(
          new Error('The operation timed out. Its outcome is uncertain; refresh before retrying.'),
        );
      }, 60000);
      this.pending.set(id, { resolve: completed, reject: failed, timer });
      try {
        this.child!.postMessage({ type: 'request', id, route, input });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        failed(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  async restart() {
    await this.stop();
    this.automaticRestarts = 0;
    await this.start();
  }
  async stop() {
    this.stopGeneration++;
    this.stopping = true;
    this.ready = false;
    const child = this.child;
    if (child)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child.kill();
          resolve();
        }, 8000);
        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        try {
          child.postMessage({ type: 'shutdown' });
        } catch {
          clearTimeout(timeout);
          child.kill();
          resolve();
        }
      });
    await this.supervisor?.close();
    this.supervisor = undefined;
    this.rejectPending(new Error('The local runtime was stopped.'));
  }
}

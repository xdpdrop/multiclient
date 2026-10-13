import { createServer, type Server } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm, chmod, lstat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { NdjsonDecoder } from '../../transports/ndjson';
import { launch, stopProcess } from '../process';
import { capabilities } from '../../../shared/defaults';
import { assertSessionMode, isBypassMode, isCodeMode } from '../../../shared/modes';
import { modelCatalog } from '../../../shared/models';
import type { AdapterContext, ProviderConnection, StartTurnRequest } from '../contracts';

/** Usable sockaddr_un.sun_path bytes, excluding the terminating NUL. */
export function sunPathLimit(platform = process.platform) {
  return platform === 'linux' ? 107 : 103;
}

/**
 * Permission bridge endpoint. Windows keeps a named pipe. Unix uses a short
 * hash under tmpdir/mc so GitHub's TMPDIR plus dataDir/bridges/<uuid> cannot
 * exceed sun_path (104 bytes on macOS, including NUL).
 */
export function permissionBridgeEndpoint(platform = process.platform, root = tmpdir()) {
  if (platform === 'win32') return `\\\\.\\pipe\\multiclient-${randomUUID()}`;
  const socket = posix.join(root, 'mc', `${randomBytes(8).toString('hex')}.sock`);
  const limit = sunPathLimit(platform);
  const bytes = Buffer.byteLength(socket);
  if (bytes > limit)
    throw new Error(
      `Permission bridge socket path is ${bytes} bytes and exceeds the ${limit}-byte sun_path limit.`,
    );
  return socket;
}

async function privateSocketDirectory() {
  const directory = join(tmpdir(), 'mc');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Permission bridge socket directory must be a real directory.');
  if (typeof process.getuid === 'function' && info.uid !== process.getuid())
    throw new Error('Permission bridge socket directory is not owned by this user.');
  if ((info.mode & 0o077) !== 0) await chmod(directory, 0o700);
}

export class ClaudeConnection implements ProviderConnection {
  capabilities = capabilities('claude-code');
  private nativeId?: string;
  private child?: ChildProcessWithoutNullStreams;
  private server?: Server;
  private dir = '';
  private socket = '';
  private token = randomBytes(32).toString('hex');
  constructor(private context: AdapterContext) {}
  async openSession({ nativeId }: { nativeId?: string }) {
    this.nativeId = nativeId;
    return { nativeId };
  }
  private async bridge() {
    if (this.server) {
      const previous = this.server;
      this.server = undefined;
      previous.close();
    }
    if (this.socket && process.platform !== 'win32') await rm(this.socket, { force: true });
    this.dir = join(this.context.dataDir, 'bridges', randomUUID());
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await privateSocketDirectory();
    this.socket = permissionBridgeEndpoint();
    this.server = createServer((socket) => {
      const parser = new NdjsonDecoder(async (request) => {
        if (request.token !== this.token || this.context.signal.aborted) {
          socket.end(
            JSON.stringify({ behavior: 'deny', message: 'Invalid or expired interaction.' }) + '\n',
          );
          return;
        }
        try {
          const name = request.input?.tool_name ?? request.input?.toolName ?? request.input?.name;
          const input = request.input?.tool_input ?? request.input?.input ?? {};
          let response: Record<string, unknown> = {
            behavior: 'deny',
            message: 'Ask mode cannot execute commands or modify files.',
          };
          if (name === 'AskUserQuestion') {
            const questions = (input.questions ?? []).map((q: any) => ({
              id: q.question,
              prompt: q.question,
              options: (q.options ?? []).map((o: any) => o.label),
              multiple: q.multiSelect,
            }));
            const answer = await this.context.interact({
              kind: 'question',
              title: 'Claude needs your input',
              detail: '',
              questions,
            });
            if (answer.allow)
              response = {
                behavior: 'allow',
                updatedInput: { ...input, answers: answer.answers ?? {} },
              };
          }
          if (name === 'ExitPlanMode') {
            await this.context.interact({
              kind: 'plan',
              title: 'Proposed plan',
              detail: input.plan ?? 'Claude is ready to leave planning mode.',
            });
            response = {
              behavior: 'deny',
              message:
                'The plan was shown to the user. Remain in Plan mode. The user can select Code for execution.',
            };
          }
          if (
            this.context.mode === 'code' &&
            ['Bash', 'Edit', 'Write', 'NotebookEdit'].includes(name)
          ) {
            const answer = await this.context.interact({
              kind: 'approval',
              title: name === 'Bash' ? 'Allow command?' : 'Allow file changes?',
              detail: `Directory: ${this.context.cwd}\n\n${JSON.stringify(input, null, 2)}`,
            });
            if (answer.allow && !this.context.signal.aborted)
              response = { behavior: 'allow', updatedInput: input };
            else response = { behavior: 'deny', message: 'The user declined this action.' };
          }
          if (request.kind === 'hook')
            response = {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: response.behavior,
                permissionDecisionReason: response.message,
                ...(response.updatedInput ? { updatedInput: response.updatedInput } : {}),
              },
            };
          socket.end(JSON.stringify(response) + '\n');
        } catch {
          socket.end(
            JSON.stringify({ behavior: 'deny', message: 'Interaction unavailable.' }) + '\n',
          );
        }
      }, 1024 * 1024);
      socket.on('data', (data) => {
        try {
          parser.push(data);
        } catch {
          socket.destroy();
        }
      });
      socket.on('error', () => {});
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socket, resolve);
    });
    if (process.platform !== 'win32') await chmod(this.socket, 0o600);
    const config = {
      mcpServers: {
        multiclient: {
          command: process.execPath,
          args: [this.context.bridgePath, 'mcp'],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            MULTICLIENT_BRIDGE_SOCKET: this.socket,
            MULTICLIENT_BRIDGE_TOKEN: this.token,
          },
        },
      },
    };
    await writeFile(join(this.dir, 'mcp.json'), JSON.stringify(config), { mode: 0o600 });
  }
  async startTurn(request: StartTurnRequest) {
    assertSessionMode(this.context.mode, request.mode);
    if (
      request.effort &&
      !modelCatalog('claude-code')
        .find((model) => model.id === request.model)
        ?.efforts.includes(request.effort)
    )
      throw new Error('This Claude model does not advertise that reasoning depth.');
    await this.bridge();
    if (this.context.signal.aborted) throw new Error('Cancelled');
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...(isBypassMode(request.mode) ? ['--dangerously-skip-permissions'] : ['--restricted']),
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      join(this.dir, 'mcp.json'),
      '--permission-prompt-tool',
      'mcp__multiclient__permission',
      '--permission-mode',
      isBypassMode(request.mode)
        ? 'bypassPermissions'
        : request.mode === 'plan'
          ? 'plan'
          : 'manual',
      '--tools',
      isCodeMode(request.mode)
        ? 'Read,Glob,Grep,Bash,Edit,Write,NotebookEdit,AskUserQuestion,ExitPlanMode'
        : 'Read,Glob,Grep,AskUserQuestion,ExitPlanMode',
      '--settings',
      JSON.stringify(
        isBypassMode(request.mode)
          ? { disableAllHooks: true }
          : { permissions: { ask: ['Bash', 'Edit', 'Write', 'NotebookEdit'] } },
      ),
    ];
    if (this.nativeId) args.push('--resume', this.nativeId);
    if (request.model) args.push('--model', request.model);
    if (request.effort) args.push('--effort', request.effort);
    const child = (this.child = launch(this.context.executable, args, this.context.cwd));
    this.context.signal.addEventListener(
      'abort',
      () => {
        void stopProcess(child);
      },
      { once: true },
    );
    let sawResult = false;
    let emittedPartial = false;
    let resultError = '';
    await new Promise<void>((resolve, reject) => {
      const parser = new NdjsonDecoder((message) => {
        if (message.session_id) {
          this.nativeId = message.session_id;
          this.context.emit({ type: 'session', nativeId: message.session_id });
        }
        if (
          message.type === 'stream_event' &&
          message.event?.type === 'content_block_delta' &&
          message.event.delta?.type === 'text_delta'
        ) {
          emittedPartial = true;
          this.context.emit({ type: 'text', text: message.event.delta.text });
        }
        if (message.type === 'assistant') {
          for (const block of message.message?.content ?? []) {
            if (block.type === 'text' && !emittedPartial)
              this.context.emit({ type: 'text', text: block.text });
            if (block.type === 'tool_use')
              this.context.emit({
                type: 'tool',
                tool: {
                  id: block.id,
                  title: block.name,
                  detail: JSON.stringify(block.input),
                  status: 'running',
                },
              });
          }
          emittedPartial = false;
        }
        if (message.type === 'user')
          for (const block of message.message?.content ?? [])
            if (block.type === 'tool_result')
              this.context.emit({
                type: 'tool',
                tool: {
                  id: block.tool_use_id,
                  title: 'Tool result',
                  detail:
                    typeof block.content === 'string'
                      ? block.content
                      : JSON.stringify(block.content),
                  status: block.is_error ? 'failed' : 'completed',
                },
              });
        if (message.type === 'result') {
          sawResult = true;
          if (message.is_error)
            resultError = message.result || message.errors?.join('\n') || 'Claude Code failed.';
          if (message.usage) this.context.emit({ type: 'usage', data: message.usage });
        }
      });
      child.stdout.on('data', (data) => {
        try {
          parser.push(data);
        } catch (e) {
          reject(e);
          void stopProcess(child);
        }
      });
      let stderr = '';
      child.stderr.on('data', (data) => {
        stderr = (stderr + data.toString()).slice(-3000);
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        try {
          parser.end();
        } catch (e) {
          reject(e);
          return;
        }
        if (code !== 0 || !sawResult || resultError)
          reject(
            new Error(
              resultError ||
                (stderr.includes('unknown option')
                  ? 'Installed Claude Code does not support the required restricted integration flags. Update the official CLI.'
                  : `Claude Code exited before completing (${code}). Check CLI login and compatibility.`),
            ),
          );
        else resolve();
      });
      child.stdin.on('error', reject);
      child.stdin.end(
        request.mode === 'review'
          ? `Review the supplied context for correctness, security and missing tests. Report actionable findings and do not modify files.\n\n${request.text}`
          : request.text,
      );
    });
  }
  async cancelTurn() {
    if (this.child) await stopProcess(this.child);
  }
  async close() {
    await this.cancelTurn();
    this.server?.close();
    this.server = undefined;
    if (this.socket && process.platform !== 'win32') await rm(this.socket, { force: true });
    this.socket = '';
    if (this.dir) await rm(this.dir, { recursive: true, force: true });
  }
}

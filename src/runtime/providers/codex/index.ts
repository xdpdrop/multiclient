import { Rpc } from '../../transports/rpc';
import { launch, stopProcess } from '../process';
import { capabilities } from '../../../shared/defaults';
import { assertSessionMode, isBypassMode, isCodeMode } from '../../../shared/modes';
import type { AdapterContext, ProviderConnection, StartTurnRequest } from '../contracts';
import type { TurnStartParams } from './protocol/v2/TurnStartParams';
import type { ReviewStartParams } from './protocol/v2/ReviewStartParams';
import type { ModelOption } from '../../../shared/types';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseCodexUsage } from './usage';

/**
 * Workspace root handed to the read-only tools process.
 * POSIX getcwd() is symlink-resolved (/var -> /private/var on macOS), so the
 * argument must be realpath'd or the tools process rejects it and exits 1.
 * Windows reports the spawn path; realpath would expand 8.3 names such as
 * RUNNER~1 and the same check would fail.
 */
export async function codexToolsRoot(cwd: string, platform = process.platform) {
  return platform === 'win32' ? cwd : realpath(cwd);
}

export class CodexConnection implements ProviderConnection {
  capabilities = capabilities('codex');
  private rpc: Rpc;
  private threadId = '';
  private turnId = '';
  turnStarted = false;
  private hasText = false;
  private items = new Map<string, any>();
  private approvals = new Map<string | number, AbortController>();
  private messages = new Map<
    string,
    { text: string; phase: 'commentary' | 'answer'; completed: boolean }
  >();
  private finish?: { resolve: () => void; reject: (error: Error) => void };
  constructor(private context: AdapterContext) {
    // Permission policy belongs to this session; never change it implicitly on a later turn.
    this.rpc = new Rpc(
      launch(
        context.executable,
        [
          'app-server',
          '--listen',
          'stdio://',
          '-c',
          isBypassMode(context.mode) ? 'approval_policy="never"' : 'approval_policy="on-request"',
          '-c',
          'approvals_reviewer="user"',
          '-c',
          isBypassMode(context.mode)
            ? 'sandbox_mode="danger-full-access"'
            : 'sandbox_mode="read-only"',
          '-c',
          'forced_login_method="chatgpt"',
          '-c',
          'mcp_servers={}',
          '-c',
          'features.hooks=false',
          '-c',
          'features.apps=false',
          '-c',
          'features.plugins=false',
          '-c',
          `features.shell_tool=${isCodeMode(context.mode)}`,
          '-c',
          `features.apply_patch_freeform=${isCodeMode(context.mode)}`,
        ],
        context.cwd,
      ),
    );
    context.signal.addEventListener(
      'abort',
      () => {
        void this.cancelTurn().finally(() => stopProcess(this.rpc.child));
      },
      { once: true },
    );
    this.rpc.on('notification', (m) => this.notification(m.method, m.params));
    this.rpc.on('request', (m) => {
      void this.request(m).catch(() => {
        try {
          this.rpc.reject(m.id, 'Client interaction cancelled.');
        } catch {
          /* Disconnected. */
        }
      });
    });
    this.rpc.on('disconnect', (e) => this.finish?.reject(e));
  }
  async initialize() {
    await this.rpc.request('initialize', {
      clientInfo: { name: 'multiclient', title: 'Multiclient', version: '0.1.0' },
      capabilities: { experimentalApi: false },
    });
    this.rpc.notify('initialized');
  }
  async accountType(): Promise<string | null> {
    const result = await this.rpc.request('account/read', { refreshToken: false }, 10000);
    return result.account?.type ?? null;
  }
  async usage() {
    return parseCodexUsage(await this.rpc.request('account/rateLimits/read', {}, 10000));
  }
  async openSession({ nativeId }: { nativeId?: string }) {
    // An empty table may merge with existing configuration. Disable each effective server.
    // Only its name is used; configuration values are neither logged nor persisted.
    const { config } = await this.rpc.request('config/read', {
      cwd: this.context.cwd,
      includeLayers: false,
    });
    const disabledMcp = Object.fromEntries(
      Object.keys(config.mcp_servers ?? {}).map((name) => [name, { enabled: false }]),
    );
    const workspaceServer = `multiclient_workspace_${randomUUID().replaceAll('-', '')}`;
    const workspace = await codexToolsRoot(this.context.cwd);
    const result = await this.rpc.request(nativeId ? 'thread/resume' : 'thread/start', {
      ...(nativeId ? { threadId: nativeId } : {}),
      cwd: this.context.cwd,
      model: this.context.connection.model || undefined,
      approvalPolicy: isBypassMode(this.context.mode) ? 'never' : 'on-request',
      approvalsReviewer: 'user',
      sandbox: isBypassMode(this.context.mode) ? 'danger-full-access' : 'read-only',
      config: {
        mcp_servers: {
          ...disabledMcp,
          [workspaceServer]: {
            command: process.execPath,
            args: [join(dirname(this.context.bridgePath), 'workspace-tools.js'), workspace],
            env: { ELECTRON_RUN_AS_NODE: '1' },
            enabled: true,
            required: true,
            enabled_tools: ['list_directory', 'read_file'],
            startup_timeout_sec: 10,
            tool_timeout_sec: 10,
          },
        },
        web_search: 'disabled',
        'features.shell_tool': isCodeMode(this.context.mode),
        'features.apply_patch_freeform': isCodeMode(this.context.mode),
      },
    });
    if (
      (isBypassMode(this.context.mode)
        ? result.sandbox?.type !== 'dangerFullAccess' || result.approvalPolicy !== 'never'
        : result.sandbox?.type !== 'readOnly' || result.sandbox.networkAccess !== false) ||
      result.approvalsReviewer !== 'user'
    )
      throw new Error(
        'Codex did not apply the selected permission policy. This version/configuration is unsupported.',
      );
    this.threadId = result.thread.id;
    this.context.emit({ type: 'session', nativeId: this.threadId });
    return { nativeId: this.threadId };
  }
  async startTurn(request: StartTurnRequest) {
    assertSessionMode(this.context.mode, request.mode);
    if (request.effort) {
      if (request.mode === 'review')
        throw new Error('Native review manages its own reasoning depth.');
      const selected = (await this.models()).find((model) => model.id === request.model);
      if (!selected?.efforts.includes(request.effort))
        throw new Error('This Codex model does not advertise that reasoning depth.');
    }
    const account = await this.rpc.request('account/read', { refreshToken: false });
    if (account.account?.type !== 'chatgpt')
      throw new Error(
        'Sign into Codex with ChatGPT before sending. Use an API connection for separately billed API chat.',
      );
    this.hasText = false;
    this.turnStarted = false;
    this.messages.clear();
    this.items.clear();
    await new Promise<void>((resolve, reject) => {
      this.finish = { resolve, reject };
      const params: TurnStartParams = {
        threadId: this.threadId,
        input: [
          {
            type: 'text',
            text:
              request.mode === 'plan'
                ? `Plan the work without executing it. Ask questions when necessary.\n\n${request.text}`
                : request.text,
            text_elements: [],
          },
        ],
        model: request.model || undefined,
        effort: request.effort || null,
        approvalPolicy: isBypassMode(this.context.mode) ? 'never' : 'on-request',
        approvalsReviewer: 'user',
        sandboxPolicy: isBypassMode(this.context.mode)
          ? { type: 'dangerFullAccess' }
          : { type: 'readOnly', networkAccess: false },
      };
      const review: ReviewStartParams = {
        threadId: this.threadId,
        target: { type: 'custom', instructions: request.text },
        delivery: 'inline',
      };
      this.rpc
        .request(
          request.mode === 'review' ? 'review/start' : 'turn/start',
          request.mode === 'review' ? review : params,
        )
        .then((result) => {
          this.turnId = result.turn.id;
          this.turnStarted = true;
          if (this.context.signal.aborted) void this.cancelTurn();
        }, reject);
    });
  }
  private notification(method: string, p: any) {
    if (p?.threadId && this.threadId && p.threadId !== this.threadId) return;
    if (method === 'serverRequest/resolved') {
      this.approvals.get(p.requestId)?.abort();
      this.approvals.delete(p.requestId);
    }
    if (method === 'item/started' && p.item?.id) this.items.set(p.item.id, p.item);
    if (method === 'item/agentMessage/delta') {
      const id = p.itemId ?? 'response';
      const message = this.messages.get(id) ?? {
        text: '',
        phase: 'answer' as const,
        completed: false,
      };
      if (!message.completed && typeof p.delta === 'string') {
        this.messages.set(id, message);
        this.messageText(id, message, p.delta);
      }
    }
    if (
      (method === 'item/started' || method === 'item/completed') &&
      p.item?.type === 'agentMessage'
    ) {
      const id = p.item.id;
      const message = this.messages.get(id) ?? {
        text: '',
        phase: 'answer' as const,
        completed: false,
      };
      message.phase = p.item.phase === 'commentary' ? 'commentary' : 'answer';
      this.messages.set(id, message);
      if (method === 'item/completed' && !message.completed) {
        // Completion snapshots repeat streamed text; only append a missing suffix.
        const fullText = p.item.text;
        if (typeof fullText === 'string' && fullText.startsWith(message.text))
          this.messageText(id, message, fullText.slice(message.text.length));
        message.completed = true;
      }
    }
    if (
      method === 'item/completed' &&
      p.item?.type === 'exitedReviewMode' &&
      !this.hasText &&
      p.item.review
    ) {
      this.hasText = true;
      this.context.emit({ type: 'text', text: p.item.review });
    }
    if (method === 'turn/started') {
      this.turnId = p.turn.id;
      this.turnStarted = true;
    }
    if (method === 'turn/completed') {
      for (const approval of this.approvals.values()) approval.abort();
      this.approvals.clear();
      const t = p.turn;
      if (t.status === 'failed')
        this.finish?.reject(new Error(t.error?.message ?? 'Codex turn failed.'));
      else if (t.status === 'interrupted')
        this.finish?.reject(new Error('Codex turn interrupted.'));
      else this.finish?.resolve();
      this.finish = undefined;
    }
    if (
      (method === 'item/started' || method === 'item/completed') &&
      p.item?.type !== 'agentMessage' &&
      p.item?.type !== 'userMessage' &&
      p.item?.type !== 'reasoning'
    ) {
      this.context.emit({
        type: 'tool',
        tool: {
          id: p.item.id,
          title: p.item.type === 'mcpToolCall' ? p.item.tool : p.item.type,
          detail:
            p.item.command ??
            p.item.text ??
            (p.item.arguments ? JSON.stringify(p.item.arguments) : ''),
          status:
            method === 'item/started'
              ? 'running'
              : p.item.status === 'failed'
                ? 'failed'
                : 'completed',
        },
      });
    }
    if (method === 'error')
      this.context.emit({
        type: 'warning',
        message: p?.error?.message ?? 'Codex reported an error.',
      });
  }
  private messageText(
    id: string,
    message: { text: string; phase: 'commentary' | 'answer' },
    delta: string,
  ) {
    if (!delta) return;
    message.text += delta;
    this.hasText = true;
    this.context.emit({ type: 'text', text: delta, itemId: id, phase: message.phase });
  }
  private async request(m: any) {
    const { method, params: p, id } = m;
    if (method === 'item/tool/requestUserInput') {
      const questions = (p.questions ?? []).map((q: any) => ({
        id: q.id,
        prompt: q.question,
        options: (q.options ?? []).map((o: any) => o.label),
      }));
      const answer = await this.context.interact({
        kind: 'question',
        title: 'Codex needs your input',
        detail: '',
        questions,
      });
      this.rpc.respond(id, {
        answers: Object.fromEntries(
          questions.map((q: any) => [
            q.id,
            { answers: [answer.answers?.[q.id] ?? 'User declined to answer.'] },
          ]),
        ),
      });
      return;
    }
    if (method.endsWith('/requestApproval')) {
      const file = method === 'item/fileChange/requestApproval';
      const command = method === 'item/commandExecution/requestApproval';
      let allow = false;
      if (
        this.context.mode === 'code' &&
        this.finish !== undefined &&
        (file || command) &&
        p.threadId === this.threadId &&
        p.turnId === this.turnId &&
        typeof p.itemId === 'string' &&
        !this.context.signal.aborted
      ) {
        const item = this.items.get(p.itemId);
        const detail = file
          ? item?.changes?.map((change: any) => `${change.path}\n${change.diff ?? ''}`).join('\n\n')
          : (p.networkApprovalContext ?? p.command);
        // Never approve a file operation without the corresponding proposed diff.
        if (detail) {
          const approval = new AbortController();
          this.approvals.set(id, approval);
          try {
            const answer = await this.context.interact(
              {
                kind: 'approval',
                title: file
                  ? 'Allow file changes?'
                  : p.networkApprovalContext
                    ? 'Allow network access?'
                    : 'Allow command?',
                detail: [
                  `Directory: ${p.cwd ?? this.context.cwd}`,
                  typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2),
                  p.reason,
                ]
                  .filter(Boolean)
                  .join('\n\n'),
              },
              approval.signal,
            );
            allow = answer.allow && !approval.signal.aborted && !this.context.signal.aborted;
          } finally {
            this.approvals.delete(id);
          }
        }
      }
      this.rpc.respond(
        id,
        method === 'item/permissions/requestApproval'
          ? { permissions: {}, scope: 'turn' }
          : { decision: allow ? 'accept' : 'decline' },
      );
      return;
    }
    this.rpc.reject(id);
  }
  async login() {
    const result = await this.rpc.request('account/login/start', { type: 'chatgpt' });
    return {
      url: result.authUrl as string,
      message: 'Complete sign-in in your browser. Codex manages your credentials.',
    };
  }
  async models(): Promise<ModelOption[]> {
    const result = await this.rpc.request('model/list', {});
    return (result.data ?? [])
      .filter((m: any) => !m.hidden && (m.model || m.id))
      .map((m: any) => ({
        id: m.model ?? m.id,
        label: m.displayName || m.model || m.id,
        efforts: (m.supportedReasoningEfforts ?? [])
          .map((option: any) => option.reasoningEffort)
          .filter((value: unknown) => typeof value === 'string'),
      }));
  }
  async cancelTurn() {
    if (this.threadId && this.turnId)
      await this.rpc
        .request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }, 3000)
        .catch(() => {});
  }
  async close() {
    for (const approval of this.approvals.values()) approval.abort();
    this.approvals.clear();
    this.rpc.close();
    await stopProcess(this.rpc.child);
  }
}

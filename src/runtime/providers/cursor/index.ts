import { Rpc } from '../../transports/rpc';
import { launch, stopProcess } from '../process';
import { capabilities } from '../../../shared/defaults';
import { assertSessionMode, isBypassMode, isCodeMode } from '../../../shared/modes';
import type { AdapterContext, ProviderConnection, StartTurnRequest } from '../contracts';
export class CursorConnection implements ProviderConnection {
  capabilities = capabilities('cursor');
  private rpc: Rpc;
  private sessionId = '';
  private modes: string[] = [];
  private activeMode = 'ask';
  constructor(private context: AdapterContext) {
    this.rpc = new Rpc(
      launch(
        context.executable,
        isBypassMode(context.mode)
          ? ['--force', '--sandbox', 'disabled', 'acp']
          : ['--mode=ask', '--sandbox', 'enabled', 'acp'],
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
    this.rpc.on('notification', (m) => {
      if (m.method !== 'session/update' || m.params.sessionId !== this.sessionId) return;
      const u = m.params.update;
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text')
        context.emit({ type: 'text', text: u.content.text });
      if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update')
        context.emit({
          type: 'tool',
          tool: {
            id: u.toolCallId,
            title: u.title ?? 'Cursor tool',
            detail: JSON.stringify(u.rawInput ?? {}),
            status:
              u.status === 'completed' ? 'completed' : u.status === 'failed' ? 'failed' : 'running',
          },
        });
    });
    this.rpc.on('request', (m) => {
      void this.handleRequest(m).catch(() => {
        try {
          this.rpc.reject(m.id, 'Interaction cancelled.');
        } catch {
          /* Disconnected. */
        }
      });
    });
  }
  async openSession({ nativeId }: { nativeId?: string }) {
    const init = await this.rpc.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'multiclient', version: '0.1.0' },
    });
    if (nativeId && !init.agentCapabilities?.loadSession)
      throw new Error(
        'This Cursor version cannot resume sessions. Start a new conversation with a handoff.',
      );
    const result = await this.rpc.request(nativeId ? 'session/load' : 'session/new', {
      ...(nativeId ? { sessionId: nativeId } : {}),
      cwd: this.context.cwd,
      mcpServers: [],
    });
    this.sessionId = result.sessionId ?? nativeId;
    this.modes = (result.modes?.availableModes ?? []).map((m: any) => m.id);
    const ask = result.modes?.availableModes?.find((m: any) => m.id === 'ask');
    if (!ask)
      throw new Error('This Cursor version did not advertise Ask mode; execution is disabled.');
    await this.rpc.request('session/set_mode', { sessionId: this.sessionId, modeId: ask.id });
    this.context.emit({ type: 'session', nativeId: this.sessionId });
    return { nativeId: this.sessionId };
  }
  private async handleRequest(m: any) {
    const p = m.params;
    if (m.method === 'session/request_permission') {
      const deny = p.options?.find((o: any) => o.kind === 'reject_once');
      const allow = p.options?.find((o: any) => o.kind === 'allow_once');
      let selected = deny;
      if (
        this.activeMode === 'agent' &&
        !isBypassMode(this.context.mode) &&
        p.sessionId === this.sessionId &&
        allow &&
        p.toolCall &&
        !this.context.signal.aborted
      ) {
        const answer = await this.context.interact({
          kind: 'approval',
          title: p.toolCall.title ?? 'Allow Cursor action?',
          detail: `Directory: ${this.context.cwd}\n\n${JSON.stringify(p.toolCall, null, 2)}`,
        });
        if (answer.allow && this.activeMode === 'agent' && !this.context.signal.aborted)
          selected = allow;
      }
      this.rpc.respond(
        m.id,
        selected
          ? { outcome: { outcome: 'selected', optionId: selected.optionId } }
          : { outcome: { outcome: 'cancelled' } },
      );
      return;
    }
    if (m.method === 'cursor/ask_question') {
      const questions = (p.questions ?? []).map((q: any) => ({
        id: q.id,
        prompt: q.prompt,
        options: (q.options ?? []).map((o: any) => o.label),
        multiple: q.allowMultiple,
        allowFreeText: false,
      }));
      const answer = await this.context.interact({
        kind: 'question',
        title: p.title ?? 'Cursor needs your input',
        detail: '',
        questions,
      });
      if (!answer.allow) this.rpc.respond(m.id, { outcome: { outcome: 'cancelled' } });
      else
        this.rpc.respond(m.id, {
          outcome: {
            outcome: 'answered',
            answers: Object.entries(answer.answers ?? {}).map(([questionId, text]) => {
              const question = p.questions?.find((q: any) => q.id === questionId);
              const selected: string[] = question?.allowMultiple ? JSON.parse(text) : [text];
              const selectedOptionIds = (question?.options ?? [])
                .filter((o: any) => selected.includes(o.label))
                .map((o: any) => o.id);
              if (!selectedOptionIds.length) throw new Error('Choose one of the provider options.');
              return { questionId, selectedOptionIds };
            }),
          },
        });
      return;
    }
    if (m.method === 'cursor/create_plan') {
      await this.context.interact({
        kind: 'plan',
        title: p.name ?? 'Proposed plan',
        detail: p.plan ?? '',
      });
      this.rpc.respond(m.id, {
        outcome: {
          outcome: 'rejected',
          reason: 'Remain in Plan mode. The user can select Code to execute the plan.',
        },
      });
      return;
    }
    this.rpc.reject(m.id);
  }
  async startTurn(request: StartTurnRequest) {
    assertSessionMode(this.context.mode, request.mode);
    const mode = isCodeMode(request.mode) ? 'agent' : request.mode === 'plan' ? 'plan' : 'ask';
    if (!this.modes.includes(mode))
      throw new Error('The installed Cursor version does not support this mode.');
    await this.rpc.request('session/set_mode', { sessionId: this.sessionId, modeId: mode });
    this.activeMode = mode;
    if (request.model)
      await this.rpc.request('session/set_config_option', {
        sessionId: this.sessionId,
        configId: 'model',
        value: request.model,
      });
    const result = await this.rpc
      .request(
        'session/prompt',
        {
          sessionId: this.sessionId,
          prompt: [
            {
              type: 'text',
              text:
                request.mode === 'review'
                  ? `Review the supplied context for correctness, security and missing tests. Do not modify files.\n\n${request.text}`
                  : request.text,
            },
          ],
        },
        0,
      )
      .finally(() => {
        this.activeMode = 'ask';
      });
    if (result.stopReason === 'cancelled') throw new Error('Cursor turn cancelled.');
  }
  async cancelTurn() {
    this.activeMode = 'ask';
    if (this.sessionId) this.rpc.notify('session/cancel', { sessionId: this.sessionId });
  }
  async close() {
    this.rpc.close();
    await stopProcess(this.rpc.child);
  }
}

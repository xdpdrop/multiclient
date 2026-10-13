import { randomUUID } from 'node:crypto';
import type {
  Interaction,
  InteractionReply,
  ProviderInteractionReply,
  Turn,
} from '../../shared/types';
export class InteractionBroker {
  private pending = new Map<
    string,
    {
      turnId: string;
      questions?: Interaction['questions'];
      resolve: (reply: ProviderInteractionReply) => void;
      reject: (error: Error) => void;
    }
  >();
  constructor(
    private persist: (interaction: Interaction) => void,
    private resolveStored: (reply: InteractionReply) => void,
    private cancelStored: (id: string) => void = () => {},
  ) {}
  request(
    turn: Turn,
    request: Pick<Interaction, 'kind' | 'title' | 'detail' | 'questions'>,
    signal: AbortSignal,
  ): Promise<ProviderInteractionReply> {
    if (signal.aborted) return Promise.reject(new Error('Turn cancelled.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        try {
          this.cancelStored(id);
        } finally {
          reject(new Error('Turn cancelled.'));
        }
      };
      this.pending.set(id, {
        turnId: turn.id,
        questions: request.questions,
        resolve: (reply) => {
          signal.removeEventListener('abort', abort);
          resolve(reply);
        },
        reject: (error) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      });
      signal.addEventListener('abort', abort, { once: true });
      try {
        this.persist({
          ...request,
          id,
          conversationId: turn.conversationId,
          sessionId: turn.sessionId,
          turnId: turn.id,
          status: 'pending',
        });
      } catch (e) {
        this.pending.delete(id);
        signal.removeEventListener('abort', abort);
        reject(e);
      }
    });
  }
  reply(reply: InteractionReply) {
    const p = this.pending.get(reply.id);
    if (!p) throw new Error('This request expired or belongs to an earlier turn.');
    const answers: Record<string, string> = {};
    if (reply.allow && p.questions)
      for (const q of p.questions) {
        const value = reply.answers?.[q.id];
        if (value === undefined) throw new Error('Answer every question before sending.');
        if (typeof value === 'string') {
          if (!value.trim()) throw new Error('Answer every question before sending.');
          if (q.multiple && q.allowFreeText === false) {
            let selected: unknown;
            try {
              selected = JSON.parse(value);
            } catch {
              throw new Error('Choose the provider options.');
            }
            if (
              !Array.isArray(selected) ||
              !selected.length ||
              selected.some((v) => !q.options.includes(v))
            )
              throw new Error('Choose the provider options.');
          } else if (q.allowFreeText === false && !q.options.includes(value))
            throw new Error('Choose the provider options.');
          answers[q.id] = value;
        } else {
          const selected = [...new Set(value.selected)];
          const text = value.text.trim();
          if (selected.some((v) => !q.options.includes(v)) || (!q.multiple && selected.length > 1))
            throw new Error('Choose the provider options.');
          if (q.allowFreeText === false && text)
            throw new Error('This question requires a provider option.');
          if (!selected.length && !text) throw new Error('Answer every question before sending.');
          answers[q.id] =
            q.multiple && q.allowFreeText === false
              ? JSON.stringify(selected)
              : [...selected, ...(text ? [text] : [])].join(', ');
        }
      }
    this.resolveStored(reply);
    this.pending.delete(reply.id);
    p.resolve({ ...reply, answers: p.questions ? answers : undefined });
  }
  cancel(turnId: string) {
    for (const [id, p] of this.pending)
      if (p.turnId === turnId) {
        this.pending.delete(id);
        p.reject(new Error('Turn ended.'));
      }
  }
}

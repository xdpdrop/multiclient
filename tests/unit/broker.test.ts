import { describe, it, expect } from 'vitest';
import { InteractionBroker } from '../../src/runtime/permissions/broker';
import type { Interaction, Turn } from '../../src/shared/types';
const turn: Turn = { id: 'turn', conversationId: 'chat', sessionId: 'session', status: 'running' };
describe('interaction lifecycle', () => {
  it('requires one exact pending request', async () => {
    let pending!: Interaction;
    const broker = new InteractionBroker(
      (i) => (pending = i),
      () => {},
    );
    const promise = broker.request(
      turn,
      { kind: 'approval', title: 'Delete?', detail: 'Exact action' },
      new AbortController().signal,
    );
    expect(() => broker.reply({ id: 'wrong', allow: true })).toThrow();
    broker.reply({ id: pending.id, allow: false });
    expect((await promise).allow).toBe(false);
    expect(() => broker.reply({ id: pending.id, allow: true })).toThrow();
  });
  it('never approves after cancellation', async () => {
    let pending!: Interaction;
    const abort = new AbortController();
    const cancelled: string[] = [];
    const broker = new InteractionBroker(
      (i) => (pending = i),
      () => {},
      (id) => {
        cancelled.push(id);
      },
    );
    const promise = broker.request(
      turn,
      { kind: 'approval', title: 'Run?', detail: '' },
      abort.signal,
    );
    abort.abort();
    await expect(promise).rejects.toThrow('cancelled');
    expect(cancelled).toEqual([pending.id]);
    expect(() => broker.reply({ id: pending.id, allow: true })).toThrow();
  });
});

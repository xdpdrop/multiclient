import { capabilities } from '../../shared/defaults';
import type { AdapterContext, ProviderConnection, StartTurnRequest } from './contracts';
export class DemoConnection implements ProviderConnection {
  capabilities = capabilities('demo');
  constructor(private context: AdapterContext) {}
  async openSession() {
    return {};
  }
  async startTurn(request: StartTurnRequest) {
    if (request.text.includes('[blocks]')) {
      this.context.emit({
        type: 'tool',
        tool: {
          id: 'tool-1',
          title: 'Inspect folder',
          detail: 'Read the selected folder.',
          status: 'completed',
        },
      });
      this.context.emit({
        type: 'text',
        itemId: 'progress',
        phase: 'commentary',
        text: 'Checking the folder.',
      });
      this.context.emit({
        type: 'text',
        itemId: 'answer',
        phase: 'answer',
        text: 'Here is the result.\n\n```ts\nconst ok = true;\n```',
      });
      return;
    }
    if (request.text.includes('[question]'))
      await this.context.interact({
        kind: 'question',
        title: 'Choose a direction',
        detail: 'Deterministic test interaction',
        questions: [{ id: 'choice', prompt: 'Which direction?', options: ['First', 'Second'] }],
      });
    if (request.text.includes('[table]'))
      this.context.emit({
        type: 'tool',
        tool: {
          id: 'tool-1',
          title: 'Prepare comparison',
          detail: 'Compare the supplied options.',
          status: 'completed',
        },
      });
    const text = request.text.includes('[table]')
      ? '**Hosting and cost**\n\n| Option | What it means |\n|---|---|\n| n8n Cloud | n8n hosts the platform; you pay for a managed service. |\n| Self-hosted Community Edition | Run it on your own infrastructure. |\n| Paid self-hosted editions | Additional capabilities depending on the plan. |\n\nCompare the options before choosing.\n\n```text\n| literal | pipe |\n```'
      : 'This is a local test response.\n\nYour conversation is saved on this device. Connect an official CLI or API provider to start working with your own models.';
    for (const part of text.match(/.{1,8}|\n/g) ?? []) {
      if (this.context.signal.aborted) throw new Error('Cancelled');
      this.context.emit({ type: 'text', text: part });
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  async cancelTurn() {}
  async close() {}
}

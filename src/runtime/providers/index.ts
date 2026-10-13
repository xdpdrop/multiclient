import { assertProviderAvailable } from '../../shared/defaults';
import { CodexConnection } from './codex';
import { ClaudeConnection } from './claude-code';
import { CursorConnection } from './cursor';
import { ApiConnection } from './api';
import { DemoConnection } from './demo';
import type { AdapterContext, ProviderConnection } from './contracts';
export { probe } from './availability';
export async function connect(context: AdapterContext): Promise<ProviderConnection> {
  assertProviderAvailable(context.connection.id);
  switch (context.connection.id) {
    case 'codex': {
      const c = new CodexConnection(context);
      try {
        await c.initialize();
        return c;
      } catch (e) {
        await c.close();
        throw e;
      }
    }
    case 'claude-code':
      return new ClaudeConnection(context);
    case 'cursor':
      return new CursorConnection(context);
    case 'demo':
      if (process.env.MULTICLIENT_TEST_MODE === '1') return new DemoConnection(context);
      throw new Error('Test provider is unavailable.');
    default:
      return new ApiConnection(context);
  }
}

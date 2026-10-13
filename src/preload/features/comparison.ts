import type { ComparisonApi } from '../../shared/comparison';

export function comparisonApi(
  invoke: (route: string, input?: unknown) => Promise<any>,
): ComparisonApi {
  return {
    prepareComparison: (input) => invoke('prepareComparison', input),
    startComparison: (id) => invoke('startComparison', { id }),
    comparisons: () => invoke('comparisons'),
    comparison: (id) => invoke('comparison', { id }),
    cancelComparison: (id, conversationId) => invoke('cancelComparison', { id, conversationId }),
    continueComparison: (id, conversationId) =>
      invoke('continueComparison', { id, conversationId }),
  };
}

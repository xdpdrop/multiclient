import type { ErrorInfo } from './types';

export function classifyError(error: unknown): ErrorInfo {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/\b(?:sk-|sk-ant-|Bearer\s+)[\w.-]+/gi, '[redacted]')
    .slice(0, 4000);
  if (/authentication|sign[ -]?in|API key|login/i.test(message))
    return {
      code: 'authentication',
      message,
      retryable: false,
      action: 'Open Connections and sign in again.',
    };
  if (/\brate\b|\bquota\b|usage limit|HTTP 429/i.test(message))
    return {
      code: 'rate-limit',
      message,
      retryable: true,
      action: 'Check provider usage and retry after the limit resets.',
    };
  if (/permission|trust|certif|unsupported|unavailable.*mode|verification/i.test(message))
    return {
      code: 'permission',
      message,
      retryable: false,
      action: 'Review project trust and supported connection modes.',
    };
  if (/disk|storage|SQLITE|ENOSPC/i.test(message))
    return {
      code: 'storage',
      message: 'Conversation storage failed. Check disk space before retrying.',
      retryable: false,
      action: 'Check disk space and restart the runtime.',
    };
  if (/context|too large|token.*limit/i.test(message))
    return {
      code: 'context-limit',
      message,
      retryable: false,
      action: 'Shorten the context or start a new conversation.',
    };
  if (/timed out|timeout/i.test(message))
    return {
      code: 'timeout',
      message,
      retryable: true,
      action: 'Refresh the conversation before retrying; the operation may have started.',
    };
  if (/disconnect|exited|runtime stopped|connection ended|network|fetch failed/i.test(message))
    return {
      code: 'connection',
      message,
      retryable: true,
      action: 'Refresh the connection and retry explicitly.',
    };
  return {
    code: 'provider',
    message,
    retryable: true,
    action: 'Review the connection and retry explicitly.',
  };
}

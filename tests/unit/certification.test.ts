import { describe, expect, it } from 'vitest';
import {
  assertCertifiedMode,
  certification,
  effectiveCapabilities,
} from '../../src/shared/certification';
import { classifyError } from '../../src/shared/errors';

describe('provider release capabilities', () => {
  it('does not turn partial Windows Codex evidence into execution certification', () => {
    expect(certification('codex', 'codex-cli 0.158.0', 'win32')?.execution).toBe('partial');
    expect(effectiveCapabilities('codex', '0.158.0', 'win32').modes.map((mode) => mode.id)).toEqual(
      ['ask', 'plan', 'review'],
    );
    expect(() => assertCertifiedMode('codex', 'code', '0.158.0', 'win32')).toThrow(/verification/);
    expect(() => assertCertifiedMode('codex', 'code-bypass', '0.158.0', 'win32')).toThrow(
      /verification/,
    );
  });
  it('does not transfer evidence across a version or operating system', () => {
    expect(certification('codex', '0.159.0', 'win32')).toBeUndefined();
    expect(effectiveCapabilities('codex', '0.158.0', 'linux').modes.map((mode) => mode.id)).toEqual(
      ['ask'],
    );
    expect(
      effectiveCapabilities('claude-code', '2.1.252', 'win32').modes.map((mode) => mode.id),
    ).toEqual(['ask']);
    expect(effectiveCapabilities('cursor').modes.map((mode) => mode.id)).toEqual(['ask']);
  });
  it('exposes execution only with an explicit development override', () => {
    expect(() => assertCertifiedMode('cursor', 'code', '', 'win32', true)).not.toThrow();
    expect(effectiveCapabilities('openai').modes.map((mode) => mode.id)).toEqual(['chat']);
  });
});
describe('sanitized actionable errors', () => {
  it('redacts credentials and distinguishes recoverable failures', () => {
    expect(classifyError(new Error('Authentication failed: Bearer private-token'))).toMatchObject({
      code: 'authentication',
      retryable: false,
      message: 'Authentication failed: [redacted]',
    });
    expect(classifyError(new Error('Rate or usage limit reached'))).toMatchObject({
      code: 'rate-limit',
      retryable: true,
    });
    expect(classifyError(new Error('SQLITE_FULL private details'))).toMatchObject({
      code: 'storage',
      message: 'Conversation storage failed. Check disk space before retrying.',
    });
  });
});

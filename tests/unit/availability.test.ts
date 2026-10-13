import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connections } from '../../src/shared/defaults';
import { parseAuthentication, probe } from '../../src/runtime/providers/availability';
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  version: vi.fn(),
  exec: vi.fn(),
  initialize: vi.fn(),
  account: vi.fn(),
  usage: vi.fn(),
  close: vi.fn(),
}));
vi.mock('../../src/runtime/providers/process', () => ({
  findExecutable: mocks.find,
  version: mocks.version,
  exec: mocks.exec,
  childEnvironment: () => ({}),
}));
vi.mock('../../src/runtime/providers/codex', () => ({
  CodexConnection: class {
    initialize = mocks.initialize;
    accountType = mocks.account;
    usage = mocks.usage;
    close = mocks.close;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue('/official/cli');
  mocks.version.mockResolvedValue('1.0');
  mocks.initialize.mockResolvedValue(undefined);
  mocks.account.mockResolvedValue('chatgpt');
  mocks.usage.mockResolvedValue({ checkedAt: '2026-09-29T12:00:00Z', windows: [] });
  mocks.close.mockResolvedValue(undefined);
});
describe('connection readiness', () => {
  it('accepts keyless loopback configuration without claiming verified inference', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await probe({
      ...connections.find((c) => c.id === 'compatible')!,
      endpoint: 'http://localhost:11434/v1',
    });
    expect(result.status).toBe('unknown');
    expect(result.detail).toContain('no key required');
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('requires credentials for remote cloud configuration and rejects insecure endpoints', async () => {
    const config = connections.find((c) => c.id === 'openai')!;
    expect((await probe(config)).status).toBe('sign-in');
    expect((await probe({ ...config, configured: true })).status).toBe('unknown');
    expect((await probe({ ...config, endpoint: 'http://example.com/v1' })).status).toBe('error');
  });
  it('keeps a signed-in connection ready when usage is unavailable', async () => {
    mocks.usage.mockRejectedValue(new Error('Quota endpoint unavailable'));
    const result = await probe(connections[0]);
    expect(result.status).toBe('ready');
    expect(result.usage).toBeUndefined();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('checks the Codex account and closes the check without opening a session', async () => {
    expect((await probe(connections[0])).status).toBe('ready');
    expect(mocks.account).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    mocks.account.mockResolvedValue('apiKey');
    expect((await probe(connections[0])).status).toBe('sign-in');
  });
  it('does not confuse missing installations, broken executables and auth failures', async () => {
    mocks.find.mockRejectedValueOnce(new Error('missing'));
    expect((await probe(connections[2])).status).toBe('not-installed');
    mocks.version.mockRejectedValueOnce(new Error('broken'));
    expect((await probe(connections[0])).status).toBe('error');
    mocks.account.mockRejectedValueOnce(new Error('secret account details'));
    const result = await probe(connections[0]);
    expect(result.status).toBe('error');
    expect(result.detail).not.toContain('secret');
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('reads Claude structured sign-in, including its signed-out exit code', async () => {
    mocks.exec.mockResolvedValueOnce({
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        email: 'private@example.com',
      }),
    });
    const ready = await probe(connections[1]);
    expect(ready.status).toBe('ready');
    expect(JSON.stringify(ready)).not.toContain('private@example.com');
    mocks.exec.mockRejectedValueOnce({ code: 1, stdout: '{"loggedIn":false}' });
    expect((await probe(connections[1])).status).toBe('sign-in');
    mocks.exec.mockResolvedValueOnce({ stdout: 'unexpected format' });
    expect((await probe(connections[1])).status).toBe('error');
  });
  it('requires explicit recognized Cursor sign-in evidence', () => {
    expect(parseAuthentication('cursor', 'Logged in as private@example.com').status).toBe('ready');
    expect(
      parseAuthentication(
        'cursor',
        'Not authenticated. Previously logged in as private@example.com',
      ).status,
    ).toBe('sign-in');
    expect(parseAuthentication('cursor', 'Usage: agent status').status).toBe('unknown');
  });
  it('does not accept API credentials as a Claude subscription', () => {
    expect(
      parseAuthentication('claude-code', '{"loggedIn":true,"authMethod":"api_key"}').status,
    ).toBe('sign-in');
    expect(parseAuthentication('claude-code', '{"loggedIn":true}').status).toBe('unknown');
  });
});

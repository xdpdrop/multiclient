import { describe, expect, it, vi } from 'vitest';
import {
  publicAddress,
  publicUrl,
  fetchPublicPage,
  type ResearchNetwork,
} from '../../src/runtime/research/network';
import { researchLimits } from '../../src/shared/research';

function network() {
  return {
    resolve: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
    get: vi.fn<ResearchNetwork['get']>(async () => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      bytes: Buffer.from('<p>Captured</p>'),
    })),
  };
}
describe('public web transport boundaries', () => {
  it('cancels a stalled DNS lookup without starting a connection', async () => {
    const stalled = network();
    stalled.resolve.mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = fetchPublicPage('https://example.com/', controller.signal, stalled);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(stalled.get).not.toHaveBeenCalled();
  });
  it('charges failed response bodies against the aggregate capture budget', async () => {
    const failed = network();
    failed.get.mockResolvedValue({
      status: 403,
      headers: { 'content-type': 'text/plain' },
      bytes: Buffer.alloc(60),
    });
    const budget = { remaining: 100 };
    await expect(
      fetchPublicPage(
        'https://example.com/',
        new AbortController().signal,
        failed,
        undefined,
        budget,
      ),
    ).rejects.toThrow('HTTP 403');
    expect(budget.remaining).toBe(40);
    await expect(
      fetchPublicPage(
        'https://example.com/',
        new AbortController().signal,
        failed,
        undefined,
        budget,
      ),
    ).rejects.toThrow('download limit');
    expect(failed.get.mock.calls[1][3]).toBe(40);
  });
  it('rejects local, encoded IP, credential, port and unsupported-scheme URLs before DNS', () => {
    for (const url of [
      'http://example.com',
      'file:///C:/secret',
      'https://localhost/',
      'https://example.local/',
      'https://example.internal/',
      'https://127.1/',
      'https://2130706433/',
      'https://0x7f000001/',
      'https://[::1]/',
      'https://user:password@example.com/',
      'https://example.com:8443/',
    ])
      expect(() => publicUrl(url), url).toThrow();
    expect(publicUrl('https://EXAMPLE.COM./article#part').href).toBe('https://example.com/article');
  });
  it('blocks private and special IPv4, IPv6 and mapped addresses', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '192.0.2.3',
      '198.18.0.1',
      '224.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:8.8.8.8',
      'fc00::1',
      'fe80::1',
      '2001:db8::1',
      '2002:7f00:1::',
      '64:ff9b::7f00:1',
    ])
      expect(publicAddress(address), address).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
    expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('passes the checked address to the connection and rejects mixed DNS answers', async () => {
    const valid = network();
    await fetchPublicPage('https://example.com/', new AbortController().signal, valid);
    expect(valid.get.mock.calls[0][1]).toEqual({ address: '93.184.216.34', family: 4 });
    const mixed = network();
    mixed.resolve.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.2', family: 4 },
    ]);
    await expect(
      fetchPublicPage('https://example.com/', new AbortController().signal, mixed),
    ).rejects.toThrow('private');
    expect(mixed.get).not.toHaveBeenCalled();
  });
  it('revalidates redirects and never forwards credentials to a redirect destination', async () => {
    const redirected = network();
    redirected.get.mockResolvedValueOnce({
      status: 302,
      headers: { 'content-type': 'text/html', location: 'https://internal.example.com/' } as any,
      bytes: Buffer.alloc(0),
    });
    redirected.resolve
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '192.168.1.2', family: 4 }]);
    await expect(
      fetchPublicPage('https://example.com/', new AbortController().signal, redirected),
    ).rejects.toThrow('private');
    expect(redirected.get).toHaveBeenCalledTimes(1);
    const secret = network();
    secret.get.mockResolvedValue({
      status: 302,
      headers: {
        'content-type': 'application/json',
        location: 'https://other.example.com/',
      } as any,
      bytes: Buffer.alloc(0),
    });
    await expect(
      fetchPublicPage('https://api.search.brave.com/', new AbortController().signal, secret, {
        'X-Subscription-Token': 'fixture-secret',
      }),
    ).rejects.toThrow('credentials cannot follow');
    expect(secret.get).toHaveBeenCalledTimes(1);
  });
  it('bounds redirect loops, content and cancellation', async () => {
    const loop = network();
    loop.get.mockResolvedValue({
      status: 302,
      headers: { 'content-type': 'text/html', location: '/again' } as any,
      bytes: Buffer.alloc(0),
    });
    await expect(
      fetchPublicPage('https://example.com/', new AbortController().signal, loop),
    ).rejects.toThrow('redirects');
    expect(loop.get).toHaveBeenCalledTimes(4);
    const large = network();
    large.get.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/html' },
      bytes: Buffer.alloc(researchLimits.htmlBytes + 1),
    });
    await expect(
      fetchPublicPage('https://example.com/', new AbortController().signal, large),
    ).rejects.toThrow('limit');
    const controller = new AbortController();
    controller.abort();
    const cancelled = network();
    await expect(
      fetchPublicPage('https://example.com/', controller.signal, cancelled),
    ).rejects.toThrow();
    expect(cancelled.resolve).not.toHaveBeenCalled();
  });
});

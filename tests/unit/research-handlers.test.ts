import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ContextSnapshot } from '../../src/shared/context';
import type { Store } from '../../src/runtime/storage/store';
import type { ResearchEvent } from '../../src/shared/research';
const snapshots = vi.hoisted(() => new Map<string, ContextSnapshot>());
vi.mock('../../src/runtime/context/storage', () => ({
  ContextStore: class {
    createSnapshot(input: Omit<ContextSnapshot, 'id' | 'createdAt'>) {
      const snapshot = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      snapshots.set(snapshot.id, structuredClone(snapshot));
      return snapshot;
    }
    snapshot(id: string) {
      const value = snapshots.get(id);
      if (!value) throw new Error('missing source');
      return structuredClone(value);
    }
  },
}));
import { createResearchHandlers } from '../../src/runtime/research';
const services: ReturnType<typeof createResearchHandlers>[] = [];
function fixture() {
  const events: ResearchEvent[] = [];
  const network = {
    resolve: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
    get: vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      bytes: Buffer.from('Immutable original evidence'),
    })),
  };
  const extract = vi.fn(async (bytes: Uint8Array) => ({
    title: 'Evidence',
    text: Buffer.from(bytes).toString(),
    paragraphs: [{ id: 1, text: Buffer.from(bytes).toString() }],
    truncated: false,
  }));
  const secret = vi.fn(async () => 'fixture-brave-key');
  const service = createResearchHandlers({
    store: { db: { prepare: () => ({ get: () => ({}) }) } } as unknown as Store,
    dataDir: '',
    emit: (event) => events.push(event),
    secret,
    network,
    extract,
  });
  services.push(service);
  return { ...service, events, network, secret, extract };
}
afterEach(() => {
  services.splice(0).forEach((service) => service.dispose());
  snapshots.clear();
});
describe('research preparation lifecycle', () => {
  it('captures immutable sources once per request and never includes search secrets', async () => {
    const service = fixture();
    const input = {
      requestId: randomUUID(),
      draftKey: 'personal',
      urls: ['https://example.com/report'],
    };
    const initial = service.routes.webFetch(input);
    expect(service.routes.webFetch(input).id).toBe(initial.id);
    await vi.waitFor(() =>
      expect(
        service.routes.webResearchJob({ id: initial.id, draftKey: input.draftKey }).status,
      ).toBe('completed'),
    );
    const job = service.routes.webResearchJob({ id: initial.id, draftKey: input.draftKey });
    const source = service.routes.webSource({ id: job.pages[0].sourceId });
    expect(source.snapshot.text).toBe('Immutable original evidence');
    expect(source.hash).toHaveLength(64);
    expect(service.network.get).toHaveBeenCalledTimes(1);
    expect(service.secret).not.toHaveBeenCalled();
    source.snapshot.text = 'Edited caller copy';
    expect(service.routes.webSource({ id: job.pages[0].sourceId }).snapshot.text).toBe(
      'Immutable original evidence',
    );
    expect(JSON.stringify(service.events)).not.toContain('fixture-brave-key');
    expect(() => service.routes.webResearchJob({ id: initial.id, draftKey: 'other' })).toThrow(
      'draft',
    );
    expect(() =>
      service.routes.webFetch({ ...input, urls: ['https://example.com/other'] }),
    ).toThrow('different');
  });
  it('cancels in-flight capture before committing a source and does not replay it', async () => {
    const service = fixture();
    let release: (() => void) | undefined;
    service.extract.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        title: 'Cancelled',
        text: 'Do not commit',
        paragraphs: [{ id: 1, text: 'Do not commit' }],
        truncated: false,
      };
    });
    const input = {
      requestId: randomUUID(),
      draftKey: 'personal',
      urls: ['https://example.com/report'],
    };
    const job = service.routes.webFetch(input);
    await vi.waitFor(() => expect(release).toBeDefined());
    service.routes.webCancel({ id: job.id, draftKey: input.draftKey });
    release!();
    await vi.waitFor(() =>
      expect(service.routes.webResearchJob({ id: job.id, draftKey: input.draftKey }).status).toBe(
        'cancelled',
      ),
    );
    expect(snapshots.size).toBe(0);
    service.routes.webFetch(input);
    expect(service.extract).toHaveBeenCalledTimes(1);
  });
  it('keeps Brave results transient and sends its key only to the fixed search endpoint', async () => {
    const service = fixture();
    service.network.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      bytes: Buffer.from(
        JSON.stringify({
          web: {
            results: [
              {
                url: 'https://example.com/report',
                title: 'Result',
                description: 'Search-only snippet',
              },
              { url: 'http://localhost/private', title: 'Private' },
            ],
          },
        }),
      ),
    });
    expect(await service.routes.webSearch({ query: 'Current evidence' })).toEqual([
      { url: 'https://example.com/report', title: 'Result', snippet: 'Search-only snippet' },
    ]);
    const call = service.network.get.mock.calls[0] as unknown as [
      URL,
      unknown,
      unknown,
      unknown,
      Record<string, string>,
    ];
    expect(call[0].hostname).toBe('api.search.brave.com');
    expect(call[0].searchParams.get('q')).toBe('Current evidence');
    expect(call[4]['X-Subscription-Token']).toBe('fixture-brave-key');
    expect(snapshots.size).toBe(0);
    expect(service.events).toEqual([]);
    expect(service.extract).not.toHaveBeenCalled();
  });
  it('preserves successful sources when another page fails and rejects excess jobs', async () => {
    const service = fixture();
    service.network.get.mockResolvedValueOnce({
      status: 403,
      headers: { 'content-type': 'text/plain' },
      bytes: Buffer.alloc(0),
    });
    const input = {
      requestId: randomUUID(),
      draftKey: 'personal',
      urls: ['https://example.com/blocked', 'https://example.com/report'],
    };
    const job = service.routes.webFetch(input);
    expect(() => service.routes.webFetch({ ...input, requestId: randomUUID() })).toThrow('active');
    await vi.waitFor(() =>
      expect(service.routes.webResearchJob({ id: job.id, draftKey: input.draftKey }).status).toBe(
        'completed',
      ),
    );
    const result = service.routes.webResearchJob({ id: job.id, draftKey: input.draftKey });
    expect(result.pages.map((page) => page.status)).toEqual(['failed', 'ready']);
    expect(snapshots.size).toBe(1);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WebSources, WebSourceInspector } from '../../src/renderer/features/WebSources';
import { SourceCitationList } from '../../src/renderer/features/SourceCitationList';
import type { ResearchApi, ResearchJob, WebSource } from '../../src/shared/research';
const source: WebSource = {
  snapshot: {
    id: '12345678-1234-4234-8234-123456789012',
    itemId: null,
    revision: 1,
    kind: 'web',
    title: 'Captured evidence',
    text: 'Saved evidence',
    projectId: null,
    createdAt: '2026-10-12T12:00:00Z',
  },
  requestedUrl: 'https://example.com/report',
  finalUrl: 'https://example.com/report',
  mime: 'text/plain',
  hash: 'a'.repeat(64),
  truncated: false,
  paragraphs: [{ id: 1, text: 'Saved evidence' }],
};
function fixture() {
  const job: ResearchJob = {
    id: '12345678-1234-4234-8234-123456789013',
    draftKey: 'first',
    status: 'running',
    pages: [{ url: source.finalUrl, status: 'fetching' }],
  };
  const api = {
    webCredentialStatus: vi.fn(async () => ({ configured: false })),
    webSaveCredential: vi.fn(async () => ({ persisted: true })),
    webSearch: vi.fn(async () => []),
    webFetch: vi.fn(async () => job),
    webResearchJob: vi.fn(async () => ({
      ...job,
      status: 'completed' as const,
      pages: [{ url: source.finalUrl, status: 'ready' as const, sourceId: source.snapshot.id }],
    })),
    webCancel: vi.fn(async () => {}),
    webSource: vi.fn(async () => source),
  } satisfies ResearchApi;
  return { api, job, onChange: vi.fn(), onError: vi.fn(), onClose: vi.fn() };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
describe('web preparation interface', () => {
  it('displays truncated provenance without presenting omitted markers as verified links', () => {
    const setup = fixture();
    render(
      createElement(SourceCitationList, {
        api: setup.api,
        onInspect: vi.fn(),
        audit: {
          valid: [],
          unresolved: [],
          sources: [],
          truncated: true,
          omittedOccurrences: 9000,
        },
      }),
    );
    expect(screen.getByText(/Source reference audit truncated/)).toBeTruthy();
    expect(screen.getByText(/Additional markers remain unverified/)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(setup.api.webSource).not.toHaveBeenCalled();
  });
  it('captures URL evidence without a search key and adds it only through the explicit draft action', async () => {
    const setup = fixture();
    render(createElement(WebSources, { ...setup, draftKey: 'first', contextRefs: [] }));
    fireEvent.change(screen.getByLabelText(/Public HTTPS URLs/), {
      target: { value: source.finalUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read pages' }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Use selected sources' })).toBeTruthy(),
      { timeout: 2000 },
    );
    expect(setup.api.webFetch).toHaveBeenCalledWith(
      expect.objectContaining({ draftKey: 'first', urls: [source.finalUrl] }),
    );
    expect(setup.api.webSearch).not.toHaveBeenCalled();
    expect(setup.onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use selected sources' }));
    expect(setup.onChange).toHaveBeenCalledWith([
      { snapshotId: source.snapshot.id, included: true },
    ]);
    expect(setup.onClose).toHaveBeenCalledOnce();
  });
  it('cancels a late capture response when the originating draft changes', async () => {
    const setup = fixture();
    let resolve: ((job: ResearchJob) => void) | undefined;
    setup.api.webFetch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(
      createElement(WebSources, { ...setup, draftKey: 'first', contextRefs: [] }),
    );
    fireEvent.change(screen.getByLabelText(/Public HTTPS URLs/), {
      target: { value: source.finalUrl },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read pages' }));
    await waitFor(() => expect(resolve).toBeDefined());
    view.rerender(createElement(WebSources, { ...setup, draftKey: 'second', contextRefs: [] }));
    resolve!(setup.job);
    await waitFor(() => expect(setup.api.webCancel).toHaveBeenCalledWith(setup.job.id, 'first'));
    expect(setup.onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Use selected sources' })).toBeNull();
  });
  it('shows only captured plain text and never loads source markup or remote images', async () => {
    const setup = fixture();
    setup.api.webSource.mockResolvedValue({
      ...source,
      paragraphs: [
        { id: 1, text: '<img src="https://example.com/tracker"><script>steal()</script>' },
      ],
    });
    const view = render(
      createElement(WebSourceInspector, { ...setup, sourceId: source.snapshot.id, paragraph: 1 }),
    );
    await waitFor(() => expect(screen.getByText(/steal\(\)/)).toBeTruthy());
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('script')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open original in browser' })).toBeTruthy();
  });
});

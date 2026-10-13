import { createHash } from 'node:crypto';
import type { Store } from '../storage/store';
import { ContextStore } from '../context/storage';
import {
  researchLimits,
  researchRoutes,
  type ResearchEvent,
  type ResearchJob,
  type WebSearchResult,
  type WebSource,
} from '../../shared/research';
import { extractIsolated } from './extract';
import { fetchPublicPage, publicUrl, type ResearchNetwork } from './network';
import type { ExtractedPage } from './parser';

type Options = {
  store: Store;
  dataDir: string;
  emit: (event: ResearchEvent) => void;
  secret: () => Promise<string | undefined>;
  network?: ResearchNetwork;
  extract?: (
    bytes: Uint8Array,
    mime: string,
    url: string,
    signal: AbortSignal,
  ) => Promise<ExtractedPage>;
};
type Running = { job: ResearchJob; controller: AbortController; fingerprint: string };
export function createResearchHandlers(options: Options) {
  const context = new ContextStore(options.store);
  const jobs = new Map<string, Running>();
  const searchControllers = new Set<AbortController>();
  let activeFetches = 0;
  let disposed = false;
  const waiting: (() => void)[] = [];
  const emit = (job: ResearchJob) =>
    options.emit({ type: 'research-progress', job: structuredClone(job) });
  async function acquire(signal: AbortSignal) {
    signal.throwIfAborted();
    while (activeFetches >= 2) {
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          signal.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = () => {
          const index = waiting.indexOf(resume);
          if (index >= 0) waiting.splice(index, 1);
          reject(new Error('Web capture cancelled.'));
        };
        signal.addEventListener('abort', cancel, { once: true });
        waiting.push(resume);
      });
    }
    signal.throwIfAborted();
    activeFetches++;
  }
  function release() {
    activeFetches--;
    waiting.shift()?.();
  }
  function find(id: string, draftKey: string) {
    const running = jobs.get(id);
    if (!running || running.job.draftKey !== draftKey)
      throw new Error('This research job is unavailable for this draft.');
    return running;
  }
  function source(id: string): WebSource {
    const snapshot = context.snapshot(id);
    const metadata = snapshot.source?.web;
    if (snapshot.kind !== 'web' || !snapshot.source?.url)
      throw new Error('This captured web source is unavailable.');
    return {
      snapshot,
      requestedUrl: metadata?.requestedUrl ?? snapshot.source.url,
      finalUrl: snapshot.source.url,
      mime: metadata?.mime ?? 'text/plain',
      hash: metadata?.hash ?? createHash('sha256').update(snapshot.text).digest('hex'),
      truncated: metadata?.truncated ?? false,
      paragraphs:
        metadata?.paragraphs ??
        snapshot.text.split('\n\n').map((text, index) => ({ id: index + 1, text })),
    };
  }
  async function run(running: Running, projectId: string | null) {
    const { job, controller } = running;
    const timer = setTimeout(
      () => controller.abort(new Error('The research batch reached its time limit.')),
      researchLimits.batchMs,
    );
    const budget = { remaining: researchLimits.batchBytes };
    try {
      for (const page of job.pages) {
        if (controller.signal.aborted || disposed) break;
        try {
          await acquire(controller.signal);
          try {
            page.status = 'fetching';
            emit(job);
            const captured = await fetchPublicPage(
              page.url,
              controller.signal,
              options.network,
              undefined,
              budget,
            );
            const extracted = await (options.extract ?? extractIsolated)(
              captured.bytes,
              captured.mime,
              captured.url,
              controller.signal,
            );
            controller.signal.throwIfAborted();
            if (disposed) throw new Error('Web capture interrupted.');
            const snapshot = context.createSnapshot({
              itemId: null,
              revision: 1,
              kind: 'web',
              title: extracted.title,
              text: extracted.text,
              projectId,
              source: {
                url: captured.url,
                retrievedAt: new Date().toISOString(),
                web: {
                  requestedUrl: page.url,
                  mime: captured.mime,
                  hash: createHash('sha256').update(extracted.text).digest('hex'),
                  truncated: extracted.truncated,
                  paragraphs: extracted.paragraphs,
                },
              },
            });
            page.sourceId = snapshot.id;
            page.status = 'ready';
          } finally {
            release();
          }
        } catch (error) {
          page.status = controller.signal.aborted || disposed ? 'cancelled' : 'failed';
          page.error = controller.signal.aborted
            ? 'Web capture cancelled or timed out.'
            : error instanceof Error
              ? error.message.slice(0, 500)
              : 'The web source could not be read.';
        }
        emit(job);
      }
    } finally {
      clearTimeout(timer);
      for (const page of job.pages)
        if (page.status === 'pending' || page.status === 'fetching') page.status = 'cancelled';
      job.status = disposed ? 'interrupted' : controller.signal.aborted ? 'cancelled' : 'completed';
      emit(job);
    }
  }
  const routes = {
    async webSearch(raw: unknown): Promise<WebSearchResult[]> {
      if (disposed) throw new Error('The research service stopped.');
      const { query } = researchRoutes.webSearch.parse(raw);
      if (query.split(/\s+/).length > 75) throw new Error('Search queries support up to 75 words.');
      const key = await options.secret();
      if (!key)
        throw new Error(
          'Add your own Brave Search API key in Web sources. URL capture works without a search key.',
        );
      if (searchControllers.size >= 2) throw new Error('Wait for the current searches to finish.');
      const controller = new AbortController();
      searchControllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', query);
        url.searchParams.set('count', String(researchLimits.results));
        const captured = await fetchPublicPage(url.href, controller.signal, options.network, {
          'X-Subscription-Token': key,
          accept: 'application/json',
        });
        const response = JSON.parse(captured.bytes.toString('utf8')) as {
          web?: { results?: unknown[] };
        };
        if (!Array.isArray(response.web?.results))
          throw new Error('The search service returned an invalid result list.');
        const seen = new Set<string>();
        return response.web.results.slice(0, researchLimits.results).flatMap((raw) => {
          const item = raw as { url?: unknown; title?: unknown; description?: unknown };
          if (!item || typeof item.url !== 'string' || typeof item.title !== 'string') return [];
          try {
            const url = publicUrl(item.url).href;
            if (seen.has(url)) return [];
            seen.add(url);
            return [
              {
                url,
                title: item.title.slice(0, 200),
                snippet:
                  typeof item.description === 'string' ? item.description.slice(0, 1000) : '',
              },
            ];
          } catch {
            return [];
          }
        });
      } finally {
        clearTimeout(timeout);
        searchControllers.delete(controller);
      }
    },
    webFetch(raw: unknown): ResearchJob {
      if (disposed) throw new Error('The research service stopped.');
      const input = researchRoutes.webFetch.parse(raw);
      const urls = [...new Set(input.urls.map((url) => publicUrl(url).href))];
      const fingerprint = JSON.stringify({
        draftKey: input.draftKey,
        projectId: input.projectId ?? null,
        urls,
      });
      const previous = jobs.get(input.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error('This request ID belongs to different research.');
        return structuredClone(previous.job);
      }
      if (
        input.projectId &&
        !options.store.db.prepare('SELECT 1 FROM projects WHERE id=?').get(input.projectId)
      )
        throw new Error('Choose an existing project for these sources.');
      if ([...jobs.values()].filter((running) => running.job.status === 'running').length >= 4)
        throw new Error('Stop an active research job before starting another.');
      if (
        [...jobs.values()].some(
          (running) => running.job.status === 'running' && running.job.draftKey === input.draftKey,
        )
      )
        throw new Error('This draft already has active research.');
      while (jobs.size >= 50) {
        const finished = [...jobs.entries()].find(
          ([, running]) => running.job.status !== 'running',
        );
        if (!finished) break;
        jobs.delete(finished[0]);
      }
      const running: Running = {
        job: {
          id: input.requestId,
          draftKey: input.draftKey,
          status: 'running',
          pages: urls.map((url) => ({ url, status: 'pending' })),
        },
        controller: new AbortController(),
        fingerprint,
      };
      jobs.set(input.requestId, running);
      void run(running, input.projectId ?? null);
      return structuredClone(running.job);
    },
    webResearchJob(raw: unknown): ResearchJob {
      const { id, draftKey } = researchRoutes.webResearchJob.parse(raw);
      return structuredClone(find(id, draftKey).job);
    },
    webCancel(raw: unknown) {
      const { id, draftKey } = researchRoutes.webCancel.parse(raw);
      const running = find(id, draftKey);
      if (running.job.status === 'running') running.controller.abort();
    },
    webSource(raw: unknown): WebSource {
      return source(researchRoutes.webSource.parse(raw).id);
    },
  };
  return {
    routes,
    dispose() {
      disposed = true;
      for (const running of jobs.values()) running.controller.abort();
      for (const controller of searchControllers) controller.abort();
    },
  };
}

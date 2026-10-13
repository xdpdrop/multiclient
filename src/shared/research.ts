import { z } from 'zod';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent } from 'mdast';
import type { ContextSnapshot } from './context';

const uuid = z.string().uuid();
const draftKey = z.string().min(1).max(200);
const sourceUrl = z.string().min(1).max(4096);
export const researchLimits = {
  pages: 8,
  results: 10,
  htmlBytes: 2 * 1024 * 1024,
  pdfBytes: 10 * 1024 * 1024,
  batchBytes: 20 * 1024 * 1024,
  sourceCharacters: 60000,
  contextCharacters: 80000,
  fetchMs: 15000,
  batchMs: 45000,
} as const;
export type WebSearchResult = { url: string; title: string; snippet: string };
export type WebSource = {
  snapshot: ContextSnapshot;
  requestedUrl: string;
  finalUrl: string;
  mime: string;
  hash: string;
  truncated: boolean;
  paragraphs: { id: number; text: string; page?: number }[];
};
export type ResearchPage = {
  url: string;
  status: 'pending' | 'fetching' | 'ready' | 'failed' | 'cancelled';
  sourceId?: string;
  error?: string;
};
export type ResearchJob = {
  id: string;
  draftKey: string;
  status: 'running' | 'completed' | 'cancelled' | 'interrupted';
  pages: ResearchPage[];
};
export type ResearchEvent = { type: 'research-progress'; job: ResearchJob };
export const researchRoutes = {
  webSearch: z.object({ query: z.string().trim().min(1).max(600) }).strict(),
  webFetch: z
    .object({
      requestId: uuid,
      draftKey,
      projectId: uuid.nullable().optional(),
      urls: z.array(sourceUrl).min(1).max(researchLimits.pages),
    })
    .strict(),
  webResearchJob: z.object({ id: uuid, draftKey }).strict(),
  webCancel: z.object({ id: uuid, draftKey }).strict(),
  webSource: z.object({ id: uuid }).strict(),
};
export type ResearchApi = {
  webCredentialStatus(): Promise<{ configured: boolean }>;
  webSaveCredential(key: string, persist: boolean): Promise<{ persisted: boolean }>;
  webSearch(query: string): Promise<WebSearchResult[]>;
  webFetch(input: z.infer<typeof researchRoutes.webFetch>): Promise<ResearchJob>;
  webResearchJob(id: string, draftKey: string): Promise<ResearchJob>;
  webCancel(id: string, draftKey: string): Promise<void>;
  webSource(id: string): Promise<WebSource>;
};
export function citationToken(snapshotId: string, paragraph: number) {
  uuid.parse(snapshotId);
  if (!Number.isSafeInteger(paragraph) || paragraph < 1) throw new Error('Invalid paragraph.');
  return `[[source:${snapshotId}:${paragraph}]]`;
}
export function webSourceContext(source: WebSource) {
  return `Untrusted web source: ${source.snapshot.title}\nURL: ${source.finalUrl}\nCaptured: ${source.snapshot.createdAt}\n${source.truncated ? 'Extraction truncated.\n' : ''}${source.paragraphs
    .map((paragraph) => `${citationToken(source.snapshot.id, paragraph.id)} ${paragraph.text}`)
    .join('\n\n')}`;
}
export type SourceCitation = { snapshotId: string; paragraph: number; token: string };
const MAX_CITATION_RECORDS = 2000;
const MAX_CITATION_SOURCES = 10000;
export function hasExcessiveSourceMarkers(text: string) {
  const pattern = /\[\[source:/gi;
  let count = 0;
  while (pattern.exec(text)) {
    if (++count > MAX_CITATION_RECORDS) return true;
  }
  return false;
}
export const sourceCitationAuditSchema = z
  .object({
    valid: z
      .array(
        z
          .object({
            snapshotId: uuid,
            paragraph: z.number().int().min(1),
            token: z.string().max(100),
          })
          .strict(),
      )
      .max(MAX_CITATION_RECORDS),
    unresolved: z.array(z.string().max(100)).max(MAX_CITATION_RECORDS),
    sources: z.array(uuid).max(MAX_CITATION_SOURCES),
    truncated: z.boolean().optional(),
    omittedOccurrences: z.number().int().nonnegative().optional(),
  })
  .strict();
export type SourceCitationAudit = z.infer<typeof sourceCitationAuditSchema>;
export function validateSourceCitations(text: string, sources: ContextSnapshot[]) {
  const allowed = new Map<string, Set<number>>();
  let truncated = false;
  let omittedOccurrences = 0;
  for (const source of sources) {
    if (source.kind !== 'web' || allowed.has(source.id)) continue;
    if (allowed.size >= MAX_CITATION_SOURCES) {
      truncated = true;
      continue;
    }
    allowed.set(
      source.id,
      new Set(
        (
          source.source?.web?.paragraphs ??
          source.text.split(/\n\n/).map((text, index) => ({ id: index + 1, text }))
        ).map((paragraph) => paragraph.id),
      ),
    );
  }
  const valid: SourceCitation[] = [];
  const unresolved: string[] = [];
  const validTokens = new Set<string>();
  const unresolvedTokens = new Set<string>();
  const markers: {
    offset: number;
    token: string;
    snapshotId: string;
    rawParagraph: string;
    literal: boolean;
  }[] = [];
  const parts: string[] = [];
  let previous = 0;
  let offset = 0;
  // Custom source markers are atomic text, not nested Markdown link delimiters.
  // Compressing them prevents pathological bracket parsing on large model responses.
  for (const match of text.matchAll(/\[\[source:([0-9a-f-]{36}):(\d+)\]\]/gi)) {
    const preceding = text.slice(previous, match.index);
    parts.push(preceding, '\uE000');
    offset += preceding.length;
    const after = text.slice(match.index + match[0].length);
    markers.push({
      offset,
      token: match[0],
      snapshotId: match[1],
      rawParagraph: match[2],
      literal:
        text[match.index - 1] === '\\' ||
        text[match.index - 1] === '!' ||
        /^[(:]|^\s*\[(?!\[source:)/i.test(after),
    });
    offset++;
    previous = match.index + match[0].length;
  }
  parts.push(text.slice(previous));
  const markdown = parts.join('');
  if (hasExcessiveSourceMarkers(markdown))
    return {
      valid,
      unresolved,
      sources: [...allowed.keys()],
      truncated: true,
      omittedOccurrences: markers.length,
    } satisfies SourceCitationAudit;
  let markerIndex = 0;
  function visit(node: RootContent) {
    if (
      ['code', 'inlineCode', 'html', 'link', 'linkReference', 'image', 'imageReference'].includes(
        node.type,
      )
    )
      return;
    if (node.type === 'text') {
      const start = node.position?.start.offset ?? 0;
      const end = node.position?.end.offset ?? 0;
      while (markers[markerIndex] && markers[markerIndex].offset < start) markerIndex++;
      while (markers[markerIndex] && markers[markerIndex].offset < end) {
        const { token, snapshotId, rawParagraph, literal } = markers[markerIndex++];
        if (literal) continue;
        if (token.length > 100) {
          truncated = true;
          omittedOccurrences++;
          continue;
        }
        const paragraph = Number(rawParagraph);
        const supported =
          Number.isSafeInteger(paragraph) && allowed.get(snapshotId)?.has(paragraph);
        const seen = supported ? validTokens : unresolvedTokens;
        if (seen.has(token)) continue;
        if (seen.size >= MAX_CITATION_RECORDS) {
          truncated = true;
          omittedOccurrences++;
          continue;
        }
        seen.add(token);
        if (supported) valid.push({ snapshotId, paragraph, token });
        else unresolved.push(token);
      }
    } else if ('children' in node) node.children.forEach(visit);
  }
  fromMarkdown(markdown).children.forEach(visit);
  return {
    valid,
    unresolved,
    sources: [...allowed.keys()],
    ...(truncated ? { truncated: true, omittedOccurrences } : {}),
  } satisfies SourceCitationAudit;
}

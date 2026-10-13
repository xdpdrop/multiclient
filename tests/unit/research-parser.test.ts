import { describe, expect, it } from 'vitest';
import { extractPage } from '../../src/runtime/research/parser';
import {
  citationToken,
  validateSourceCitations,
  researchLimits,
  sourceCitationAuditSchema,
  hasExcessiveSourceMarkers,
} from '../../src/shared/research';
import type { ContextSnapshot } from '../../src/shared/context';

describe('captured page extraction and citations', () => {
  it('bounds source-marker formatting before Markdown parses valid or incomplete bracket sequences', () => {
    const token = citationToken('12345678-1234-4234-8234-123456789012', 1);
    expect(hasExcessiveSourceMarkers(token.repeat(2000))).toBe(false);
    expect(hasExcessiveSourceMarkers(token.repeat(2001))).toBe(true);
    expect(hasExcessiveSourceMarkers('[[SOURCE:incomplete '.repeat(50000))).toBe(true);
    expect(hasExcessiveSourceMarkers('Ordinary Markdown without source markers.')).toBe(false);
  });
  it('deduplicates 50,000 repeated markers while retaining the complete response text', () => {
    const source: ContextSnapshot = {
      id: '12345678-1234-4234-8234-123456789012',
      itemId: null,
      revision: 1,
      kind: 'web',
      title: 'Evidence',
      text: 'Captured evidence',
      projectId: null,
      createdAt: new Date().toISOString(),
    };
    const token = citationToken(source.id, 1);
    const message = {
      text: `${token} `.repeat(50000) + 'Partial answer preserved.',
      status: 'failed',
    };
    const before = message.text;
    const audit = sourceCitationAuditSchema.parse(validateSourceCitations(message.text, [source]));
    expect(audit.valid).toEqual([{ snapshotId: source.id, paragraph: 1, token }]);
    expect(audit.unresolved).toEqual([]);
    expect(audit.truncated).toBeUndefined();
    expect(message.text).toBe(before);
    expect(message.text.endsWith('Partial answer preserved.')).toBe(true);
    expect(message.status).toBe('failed');
  }, 30000);
  it('preserves malformed-marker floods and leaves their references unverified without parsing them', () => {
    const token = citationToken('12345678-1234-4234-8234-123456789012', 1);
    const text = '[[source:incomplete '.repeat(50000) + token + ' Partial output preserved.';
    const audit = sourceCitationAuditSchema.parse(validateSourceCitations(text, []));
    expect(audit.valid).toEqual([]);
    expect(audit.unresolved).toEqual([]);
    expect(audit.truncated).toBe(true);
    expect(audit.omittedOccurrences).toBe(1);
    expect(text.endsWith('Partial output preserved.')).toBe(true);
  });
  it('bounds more than 10,000 distinct unknown markers without crowding out valid references', () => {
    const source: ContextSnapshot = {
      id: '12345678-1234-4234-8234-123456789012',
      itemId: null,
      revision: 1,
      kind: 'web',
      title: 'Evidence',
      text: 'Captured evidence',
      projectId: null,
      createdAt: new Date().toISOString(),
    };
    const token = citationToken(source.id, 1);
    const text =
      Array.from(
        { length: 11000 },
        (_, index) => `[[source:12345678-1234-4234-8234-123456789013:${index + 1}]]`,
      ).join(' ') + ` ${token}\nPartial output stays readable.`;
    const audit = sourceCitationAuditSchema.parse(validateSourceCitations(text, [source]));
    expect(audit.unresolved).toHaveLength(2000);
    expect(new Set(audit.unresolved).size).toBe(audit.unresolved.length);
    expect(audit.valid).toEqual([{ snapshotId: source.id, paragraph: 1, token }]);
    expect(audit.truncated).toBe(true);
    expect(audit.omittedOccurrences).toBe(9000);
    expect(text.endsWith('Partial output stays readable.')).toBe(true);
  }, 30000);
  it('omits oversized tokens and admits declared imported paragraph IDs beyond their count limit', () => {
    const source: ContextSnapshot = {
      id: '12345678-1234-4234-8234-123456789012',
      itemId: null,
      revision: 1,
      kind: 'web',
      title: 'Evidence',
      text: 'Captured evidence',
      projectId: null,
      createdAt: new Date().toISOString(),
      source: {
        web: {
          requestedUrl: 'https://example.com',
          mime: 'text/plain',
          hash: 'a'.repeat(64),
          truncated: false,
          paragraphs: [{ id: 2001, text: 'Captured evidence' }],
        },
      },
    };
    const token = citationToken(source.id, 2001);
    const audit = sourceCitationAuditSchema.parse(
      validateSourceCitations(`[[source:${source.id}:${'0'.repeat(500)}1]] ${token}`, [source]),
    );
    expect(audit.valid).toEqual([{ snapshotId: source.id, paragraph: 2001, token }]);
    expect(audit.truncated).toBe(true);
    expect(audit.omittedOccurrences).toBe(1);
  });
  it('bounds the submitted source catalog and deduplicates unresolved tokens', () => {
    const sources: ContextSnapshot[] = Array.from({ length: 10001 }, (_, index) => ({
      id: `12345678-1234-4234-8234-${index.toString(16).padStart(12, '0')}`,
      itemId: null,
      revision: 1,
      kind: 'web',
      title: 'Evidence',
      text: 'Evidence',
      projectId: null,
      createdAt: '2026-10-12T12:00:00Z',
    }));
    const unknown = citationToken('22345678-1234-4234-8234-123456789012', 1);
    const audit = sourceCitationAuditSchema.parse(
      validateSourceCitations(`${unknown} ${unknown}`, sources),
    );
    expect(audit.sources).toHaveLength(10000);
    expect(audit.unresolved).toEqual([unknown]);
    expect(audit.truncated).toBe(true);
  });
  it('extracts article text without executing scripts, loading resources or rendering markup', async () => {
    const content = `<html><head><title>Saved report</title></head><body><nav>Unrelated navigation</nav><article><h1>Saved report</h1><p>${'The useful evidence belongs in the saved article. '.repeat(15)}</p><pre>const answer = 42;</pre></article><script>throw new Error('must not execute');</script><img src="https://example.com/tracker"><iframe src="https://example.com/private"></iframe></body></html>`;
    const result = await extractPage(
      Buffer.from(content),
      'text/html',
      'https://example.com/report',
    );
    expect(result.title).toBe('Saved report');
    expect(result.text).toContain('useful evidence');
    expect(result.text).toContain('const answer = 42');
    expect(result.text).not.toContain('must not execute');
    expect(result.text).not.toContain('<script');
    expect(result.text).toBe(result.paragraphs.map((paragraph) => paragraph.text).join('\n\n'));
  });
  it('splits large paragraphs to the shared metadata bound and marks truncation', async () => {
    const result = await extractPage(
      Buffer.from('a'.repeat(researchLimits.sourceCharacters + 500)),
      'text/plain',
      'https://example.com/report',
    );
    expect(result.text.length).toBeLessThanOrEqual(researchLimits.sourceCharacters);
    expect(result.truncated).toBe(true);
    expect(result.paragraphs.every((paragraph) => paragraph.text.length <= 10000)).toBe(true);
    expect(result.paragraphs.map((paragraph) => paragraph.id)).toEqual(
      result.paragraphs.map((_, index) => index + 1),
    );
  });
  it('rejects empty, binary or unsupported fetched content', async () => {
    await expect(
      extractPage(Buffer.from(''), 'text/plain', 'https://example.com/'),
    ).rejects.toThrow('No readable');
    await expect(
      extractPage(Buffer.from([255, 254]), 'text/plain', 'https://example.com/'),
    ).rejects.toThrow();
    await expect(
      extractPage(Buffer.from('{}'), 'application/json', 'https://example.com/'),
    ).rejects.toThrow('public HTML');
  });
  it('validates only actually submitted paragraphs and ignores code/HTML citation lookalikes', () => {
    const source: ContextSnapshot = {
      id: '12345678-1234-4234-8234-123456789012',
      itemId: null,
      revision: 1,
      kind: 'web',
      title: 'Report',
      text: 'First\n\nSecond',
      projectId: null,
      createdAt: new Date().toISOString(),
    };
    const first = citationToken(source.id, 1);
    const second = citationToken(source.id, 2);
    const unknown = citationToken('12345678-1234-4234-8234-123456789013', 1);
    const absentParagraph = citationToken(source.id, 3);
    const audit = validateSourceCitations(
      `Answer ${first}\n\n\`${second}\`\n\n\`\`\`text\n${second}\n\`\`\`\n\n    ${second}\n\n<div>${second}</div>\n\nUnknown ${unknown} ${absentParagraph}`,
      [source],
    );
    expect(audit.valid).toEqual([{ snapshotId: source.id, paragraph: 1, token: first }]);
    expect(audit.unresolved).toEqual([unknown, absentParagraph]);
    expect(audit.sources).toEqual([source.id]);
    expect(validateSourceCitations(first, []).valid).toEqual([]);
    expect(
      validateSourceCitations(`\\${first}\n\n[${second}](https://example.com)`, [source]).valid,
    ).toEqual([]);
  });
});

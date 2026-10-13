import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { extractPdf } from '../files/attachments';
import { researchLimits } from '../../shared/research';

export type ExtractedPage = {
  title: string;
  text: string;
  truncated: boolean;
  paragraphs: { id: number; text: string; page?: number }[];
};
export async function extractPage(
  bytes: Uint8Array,
  mime: string,
  url: string,
): Promise<ExtractedPage> {
  let title = new URL(url).hostname;
  let paragraphs: { id: number; text: string; page?: number }[] = [];
  if (mime === 'application/pdf') {
    const pages = await extractPdf(bytes);
    paragraphs = pages
      .filter((page) => page.text.trim())
      .map((page, index) => ({
        id: index + 1,
        text: page.text.trim(),
        page: page.page,
      }));
  } else {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (mime === 'text/plain')
      paragraphs = value
        .split(/\n\s*\n/)
        .filter((text) => text.trim())
        .map((text, index) => ({ id: index + 1, text: text.trim() }));
    else if (mime === 'text/html' || mime === 'application/xhtml+xml') {
      const dom = new JSDOM(value, { url });
      try {
        // No runScripts or resources option: remote code and resources remain disabled.
        const document = dom.window.document;
        document
          .querySelectorAll('script,style,noscript,iframe,object,embed,form')
          .forEach((node) => node.remove());
        const article = new Readability(document.cloneNode(true) as Document, {
          maxElemsToParse: 50000,
          disableJSONLD: true,
          serializer: (element) => element,
        }).parse();
        if (!article?.textContent?.trim())
          throw new Error(
            'No readable page text was found. This page may require sign-in or JavaScript.',
          );
        title = (article.title || title).trim().slice(0, 200);
        const root = article.content as unknown as Element;
        const blocks = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,li,td,blockquote')]
          .filter((node) => !node.parentElement?.closest('pre,li,blockquote'))
          .map((node) => (node.textContent ?? '').trim())
          .filter(Boolean);
        paragraphs = (blocks.length ? blocks : [article.textContent.trim()]).map((text, index) => ({
          id: index + 1,
          text,
        }));
      } finally {
        dom.window.close();
      }
    } else throw new Error('Attach a public HTML, text or PDF page.');
  }
  if (!paragraphs.length)
    throw new Error(
      'No readable text was found. Scanned PDFs require OCR or native document vision.',
    );
  let length = 0;
  let truncated = false;
  const bounded: typeof paragraphs = [];
  const split = paragraphs.flatMap((paragraph) => {
    const result: typeof paragraphs = [];
    for (let start = 0; start < paragraph.text.length; start += 10000)
      result.push({ ...paragraph, text: paragraph.text.slice(start, start + 10000) });
    return result;
  });
  for (const paragraph of split) {
    if (bounded.length >= 2000) {
      truncated = true;
      break;
    }
    const available = researchLimits.sourceCharacters - length - (bounded.length ? 2 : 0);
    if (available <= 0) {
      truncated = true;
      break;
    }
    const text = paragraph.text.slice(0, available);
    bounded.push({ ...paragraph, id: bounded.length + 1, text });
    length += text.length + (bounded.length > 1 ? 2 : 0);
    if (text.length !== paragraph.text.length) {
      truncated = true;
      break;
    }
  }
  return {
    title,
    text: bounded.map((paragraph) => paragraph.text).join('\n\n'),
    paragraphs: bounded,
    truncated,
  };
}

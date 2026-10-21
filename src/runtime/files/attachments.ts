import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { Attachment } from '../../shared/types';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT = 100000;
export const MAX_PDF_PAGES = 100;
export type PdfTextRun = {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};
export function joinPdfText(items: readonly PdfTextRun[]) {
  let text = '';
  let previous: { x: number; y: number; width: number; height: number } | undefined;
  for (const item of items) {
    const value = item.str.normalize('NFKC');
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const height = item.height || previous?.height || 12;
    if (!value) {
      if (item.hasEOL) {
        text += '\n';
        previous = undefined;
      }
      continue;
    }
    if (previous) {
      const lineHeight = Math.max(previous.height, height, 1);
      if (Math.abs(previous.y - y) > lineHeight * 0.5) text += '\n';
      else if (x - (previous.x + previous.width) > lineHeight * 0.25) text += ' ';
    }
    text += value;
    if (item.hasEOL) {
      text += '\n';
      previous = undefined;
    } else previous = { x, y, width: item.width || value.length, height };
  }
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}
type ImportedAttachment = {
  attachment: Attachment;
  asset?: { id: string; mime: string; type: 'image' | 'pdf'; size: number; hash: string };
};

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsModule: Promise<PdfjsModule> | undefined;
let canvasRequireBlocked = false;

// 2D matrix used by pdf.js for Type3 glyph outlines. Text positions themselves
// stay on pdf.js's own number arrays; this only replaces the canvas polyfill.
class PdfTextMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor(init?: unknown) {
    const record =
      init && typeof init === 'object' && !Array.isArray(init)
        ? (init as Record<string, unknown>)
        : undefined;
    const values = Array.isArray(init)
      ? init
      : record
        ? [record.a, record.b, record.c, record.d, record.e, record.f]
        : undefined;
    if (!values || values.length !== 6 || values.some((value) => typeof value !== 'number')) return;
    [this.a, this.b, this.c, this.d, this.e, this.f] = values as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
  }
  scaleSelf(x: number, y = x) {
    this.a *= x;
    this.b *= x;
    this.c *= y;
    this.d *= y;
    return this;
  }
  translateSelf(x: number, y = 0) {
    this.e += this.a * x + this.c * y;
    this.f += this.b * x + this.d * y;
    return this;
  }
}

function installPdfTextGlobals() {
  const scope = globalThis as unknown as Record<string, unknown>;
  scope.DOMMatrix ??= PdfTextMatrix;
  scope.Path2D ??= class PdfTextPath2D {};
  if (canvasRequireBlocked) return;
  // The legacy build require()s @napi-rs/canvas while the module evaluates, even
  // when DOMMatrix and Path2D are already present. Text extraction never renders.
  const nodeRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
  const moduleApi = nodeRequire('module') as {
    prototype: { require: (this: unknown, id: string) => unknown };
  };
  const original = moduleApi.prototype.require;
  moduleApi.prototype.require = function requireWithoutCanvas(this: unknown, id: string) {
    if (id === '@napi-rs/canvas') return {};
    return original.call(this, id);
  };
  canvasRequireBlocked = true;
}

function loadPdfjs() {
  if (!pdfjsModule) {
    installPdfTextGlobals();
    pdfjsModule = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsModule;
}

export async function extractPdf(bytes: Uint8Array) {
  const { getDocument, GlobalWorkerOptions } = await loadPdfjs();
  // PDF.js does not initialize its Node defaults inside Electron utility processes.
  const resolvePackage = createRequire(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  GlobalWorkerOptions.workerSrc = pathToFileURL(
    resolvePackage.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href;
  const task = getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    useWorkerFetch: false,
    stopAtErrors: true,
  });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PDF_PAGES)
      throw new Error(`PDFs may contain up to ${MAX_PDF_PAGES} pages. Split this document first.`);
    const pages: { page: number; text: string }[] = [];
    let length = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const value = await page.getTextContent();
      const text = joinPdfText(value.items.flatMap((item) => ('str' in item ? [item] : [])));
      length += text.length + 30;
      if (length > MAX_ATTACHMENT_TEXT)
        throw new Error('The PDF contains too much text. Split it into smaller documents.');
      pages.push({ page: number, text });
      page.cleanup();
    }
    return pages;
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('Password-protected PDFs are not supported. Export an unlocked copy first.');
    throw error;
  } finally {
    await task.destroy();
  }
}

export async function importAttachment(path: string, dataDir: string): Promise<ImportedAttachment> {
  const file = await open(path, 'r');
  let bytes: Buffer;
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Choose a regular file to attach.');
    if (info.size > MAX_ATTACHMENT_BYTES) throw new Error('Attachments may be up to 10 MB each.');
    const buffer = Buffer.alloc(info.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const result = await file.read(buffer, count, buffer.length - count, null);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count > info.size) throw new Error('The attachment changed while being read. Try again.');
    bytes = buffer.subarray(0, count);
  } finally {
    await file.close();
  }
  return importAttachmentBytes(bytes, basename(path), '', dataDir);
}

export async function importAttachmentBytes(
  bytes: Uint8Array,
  name: string,
  _declaredMime: string,
  dataDir: string,
): Promise<ImportedAttachment> {
  if (!bytes.length) throw new Error('The attachment is empty.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('Attachments may be up to 10 MB each.');
  const buffer = Buffer.from(bytes);
  const label = basename(name).slice(0, 240) || 'attachment';
  const extension = extname(label).toLowerCase();
  let mime: string;
  let kind: 'image' | 'pdf';
  let content = '';
  let pages: Attachment['pages'];
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mime = 'image/png';
    kind = 'image';
  } else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    mime = 'image/jpeg';
    kind = 'image';
  } else if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    mime = 'image/webp';
    kind = 'image';
  } else if (buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    mime = 'application/pdf';
    kind = 'pdf';
    pages = await extractPdf(buffer);
    content = pages
      .filter((page) => page.text)
      .map((page) => `[Page ${page.page}]\n${page.text}`)
      .join('\n\n');
  } else {
    if (['.png', '.jpg', '.jpeg', '.webp', '.pdf'].includes(extension))
      throw new Error('The attachment content does not match a supported image or PDF.');
    if (
      ![
        '.txt',
        '.md',
        '.csv',
        '.tsv',
        '.json',
        '.xml',
        '.html',
        '.css',
        '.js',
        '.jsx',
        '.ts',
        '.tsx',
        '.py',
        '.rs',
        '.go',
        '.java',
        '.c',
        '.h',
        '.cpp',
        '.yml',
        '.yaml',
        '.sh',
        '.ps1',
        '.sql',
        '.log',
        '',
      ].includes(extension)
    )
      throw new Error('Attach a text file, PNG/JPEG/WebP image, or PDF.');
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new Error('Text attachments must use UTF-8 encoding.');
    }
    if (content.includes('\0')) throw new Error('Binary files cannot be attached as text.');
    if (content.length > MAX_ATTACHMENT_TEXT)
      throw new Error('Text attachments may contain up to 100,000 characters.');
    return {
      attachment: {
        path: label,
        name: label,
        kind: 'text',
        content,
        size: buffer.length,
        mime: 'text/plain',
      },
    };
  }
  const id = randomUUID();
  await mkdir(join(dataDir, 'assets'), { recursive: true });
  await writeFile(join(dataDir, 'assets', id), buffer, { flag: 'wx' });
  return {
    attachment: {
      path: label,
      name: label,
      kind,
      content,
      assetId: id,
      mime,
      size: buffer.length,
      ...(pages ? { pages } : {}),
    },
    asset: {
      id,
      mime,
      type: kind,
      size: buffer.length,
      hash: createHash('sha256').update(buffer).digest('hex'),
    },
  };
}

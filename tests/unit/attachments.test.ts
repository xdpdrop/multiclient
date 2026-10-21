import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  importAttachment,
  importAttachmentBytes,
  MAX_ATTACHMENT_BYTES,
} from '../../src/main/attachments';

let directory = '';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'multiclient-attachments-test-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
function pdf() {
  const stream = 'BT /F1 12 Tf 50 750 Td (Hello document) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let value = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(value.length);
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = value.length;
  value += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}
describe('attachment capture', () => {
  it('extracts PDFs with Electron utility-process detection in an isolated process', async () => {
    const script = `
      Object.defineProperty(process.versions, 'electron', { value: '44.4.5' });
      Object.defineProperty(process, 'type', { value: 'utility' });
      const { extractPdf } = await import(${JSON.stringify(pathToFileURL(resolve('src/runtime/files/attachments.ts')).href)});
      const pages = await extractPdf(Uint8Array.from(Buffer.from(${JSON.stringify(pdf().toString('base64'))}, 'base64')));
      if (pages.length !== 1 || pages[0].text !== 'Hello document') throw new Error('Utility PDF extraction failed.');
    `;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
      timeout: 10000,
    });
  });
  it('captures text immutably and uses a display label rather than a source authority', async () => {
    const path = join(directory, 'notes.md');
    await writeFile(path, 'Original content');
    const imported = await importAttachment(path, directory);
    await writeFile(path, 'Changed content');
    expect(imported.attachment).toMatchObject({
      path: 'notes.md',
      kind: 'text',
      content: 'Original content',
    });
    expect(imported.asset).toBeUndefined();
  });
  it('copies image bytes to a UUID asset and sniffs their MIME type', async () => {
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3mEAAAAASUVORK5CYII=',
      'base64',
    );
    const imported = await importAttachmentBytes(bytes, 'screenshot.png', 'text/plain', directory);
    expect(imported.asset).toMatchObject({ type: 'image', mime: 'image/png', size: bytes.length });
    expect(await readFile(join(directory, 'assets', imported.attachment.assetId!))).toEqual(bytes);
    expect(imported.attachment.content).toBe('');
  });
  it('extracts PDF text by page while retaining the original asset', async () => {
    const imported = await importAttachmentBytes(
      pdf(),
      'document.pdf',
      'application/pdf',
      directory,
    );
    expect(imported.attachment.pages).toEqual([{ page: 1, text: 'Hello document' }]);
    expect(imported.attachment.content).toContain('[Page 1]');
    expect(imported.asset?.type).toBe('pdf');
  });
  it('extracts PDF text without loading the canvas addon', async () => {
    const script = `
      import { createRequire } from 'node:module';
      const originalRequire = (await import('node:module')).default.prototype.require;
      const { extractPdf } = await import(${JSON.stringify(pathToFileURL(resolve('src/runtime/files/attachments.ts')).href)});
      const pages = await extractPdf(Uint8Array.from(Buffer.from(${JSON.stringify(pdf().toString('base64'))}, 'base64')));
      if (pages.length !== 1 || pages[0].text !== 'Hello document') {
        throw new Error('PDF text mismatch: ' + JSON.stringify(pages));
      }
      const nodeRequire = createRequire(import.meta.url);
      const loaded = [...Object.keys(nodeRequire.cache), ...(process.moduleLoadList ?? [])].filter(
        (entry) => entry.includes('@napi-rs') && entry.includes('canvas'),
      );
      if (loaded.length) throw new Error('Loaded @napi-rs/canvas:\\n' + loaded.join('\\n'));
      const Module = (await import('node:module')).default;
      if (Module.prototype.require !== originalRequire) {
        throw new Error('Module.prototype.require still replaces the canvas addon');
      }
    `;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
      timeout: 10000,
    });
  });
  it('retains imported image and PDF bytes after the original files are deleted', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3mEAAAAASUVORK5CYII=',
      'base64',
    );
    for (const [name, bytes] of [
      ['original.png', png],
      ['original.pdf', pdf()],
    ] as const) {
      const path = join(directory, name);
      await writeFile(path, bytes);
      const captured = await importAttachment(path, directory);
      await rm(path);
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(captured.attachment.assetId).toBeTruthy();
      expect(await readFile(join(directory, 'assets', captured.attachment.assetId!))).toEqual(
        bytes,
      );
      if (name.endsWith('.pdf'))
        expect(captured.attachment.pages).toEqual([{ page: 1, text: 'Hello document' }]);
    }
  });
  it('recognizes WebP bytes independently of the declared MIME', async () => {
    const bytes = Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary');
    const imported = await importAttachmentBytes(bytes, 'screenshot.webp', 'image/png', directory);
    expect(imported.asset).toMatchObject({ type: 'image', mime: 'image/webp' });
    await expect(
      importAttachmentBytes(Buffer.from('not an image'), 'fake.webp', '', directory),
    ).rejects.toThrow('match');
  });
  it('rejects oversized, binary, unsupported and mislabeled inputs', async () => {
    await expect(
      importAttachmentBytes(new Uint8Array(MAX_ATTACHMENT_BYTES + 1), 'large.txt', '', directory),
    ).rejects.toThrow('10 MB');
    await expect(
      importAttachmentBytes(Buffer.from('bad\0data'), 'file.txt', '', directory),
    ).rejects.toThrow('Binary');
    await expect(
      importAttachmentBytes(Buffer.from('not an image'), 'file.png', '', directory),
    ).rejects.toThrow('match');
    await expect(
      importAttachmentBytes(Buffer.from('document'), 'file.docx', '', directory),
    ).rejects.toThrow('text file');
  });
});

import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import type { Attachment } from '../../shared/types';

export function AttachmentPreview({
  attachment,
  onClose,
  onChange,
}: {
  attachment: Attachment;
  onClose: () => void;
  onChange?: (a: Attachment) => void;
}) {
  const [pages, setPages] = useState(attachment.pages?.map((p) => p.page) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog title={attachment.name ?? attachment.path} wide onClose={onClose}>
      <div className="dialogBody">
        <p className="muted">
          {attachment.mime ?? 'Text'}
          {attachment.size ? ` · ${(attachment.size / 1024).toFixed(1)} KB` : ''}
          {attachment.delivery === 'text' ? ' · extracted text only' : ''}
        </p>
        {attachment.kind === 'image' && attachment.assetId ? (
          <img
            className="attachmentPreview"
            src={`media://assets/${attachment.assetId}`}
            alt={attachment.name ?? attachment.path}
          />
        ) : attachment.kind === 'pdf' ? (
          <>
            <p>
              Choose pages to send as extracted text. Native document input, when supported, sends
              the complete original PDF.
            </p>
            {!attachment.pages?.some((p) => p.text.trim()) && (
              <p role="status">
                This PDF has no searchable text. A provider with native PDF vision is required; OCR
                is unavailable.
              </p>
            )}
            <div className="pdfPages">
              {attachment.pages?.map((p) => (
                <section key={p.page}>
                  <label>
                    <input
                      type="checkbox"
                      checked={pages.includes(p.page)}
                      onChange={(e) =>
                        setPages(
                          e.target.checked ? [...pages, p.page] : pages.filter((n) => n !== p.page),
                        )
                      }
                    />
                    Page {p.page}
                  </label>
                  <pre>{p.text || 'No extracted text on this page.'}</pre>
                </section>
              ))}
            </div>
            {onChange && (
              <button
                className="button"
                disabled={busy || !pages.length}
                onClick={() => {
                  setBusy(true);
                  void window.desktop
                    .selectPdfPages(attachment, pages)
                    .then(onChange)
                    .then(onClose)
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setBusy(false));
                }}
              >
                Use selected page text
              </button>
            )}
          </>
        ) : (
          <pre className="filePreview">{attachment.content}</pre>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

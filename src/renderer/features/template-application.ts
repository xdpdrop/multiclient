export type TemplatePreview = {
  draftKey: string;
  originalText: string;
  body: string;
  action: 'append' | 'replace';
};

export function templatePreviewText(preview: TemplatePreview): string {
  return preview.action === 'replace' || !preview.originalText
    ? preview.body
    : `${preview.originalText}\n\n${preview.body}`;
}

export function applyTemplatePreview(
  preview: TemplatePreview,
  draftKey: string,
  text: string,
): string {
  if (preview.draftKey !== draftKey || preview.originalText !== text)
    throw new Error(
      'The conversation or draft changed. Preview the template again before applying it.',
    );
  const next = templatePreviewText(preview);
  if (next.length > 100000) throw new Error('This template would exceed the prompt size limit.');
  return next;
}

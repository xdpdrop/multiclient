import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import type {
  OrganizationApi,
  ConversationTag,
  PromptTemplate,
  PromptTemplateInput,
} from '../../shared/organization';
import type { DesktopApi } from '../../shared/types';
import {
  applyTemplatePreview,
  templatePreviewText,
  type TemplatePreview,
} from './template-application';

const desktop = () => window.desktop as DesktopApi & OrganizationApi;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function TagPicker({
  conversationId,
  onClose,
  onChanged,
}: {
  conversationId: string;
  onClose: () => void;
  onChanged?: () => Promise<unknown> | void;
}) {
  const [tags, setTags] = useState<ConversationTag[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<ConversationTag | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const currentId = useRef(conversationId);
  currentId.current = conversationId;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setLoaded(false);
    setTags([]);
    setSelected([]);
    setEditing(null);
    setDeleting(false);
    setName('');
    setError('');
    void Promise.all([desktop().tags(), desktop().conversationTags(conversationId)])
      .then(([all, assigned]) => {
        if (active) {
          setTags(all);
          setSelected(assigned.map((tag) => tag.id));
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (active) setError(errorText(error));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId]);
  async function act(operation: () => Promise<unknown>, done?: () => void) {
    const id = conversationId;
    setBusy(true);
    setError('');
    try {
      await operation();
      if (currentId.current === id) done?.();
    } catch (error) {
      if (currentId.current === id) setError(errorText(error));
    } finally {
      if (currentId.current === id) setBusy(false);
    }
  }
  return (
    <Dialog title="Conversation tags" onClose={onClose}>
      <div className="dialogBody">
        <p className="muted">
          Tags organize chats across projects. Renaming or deleting a label affects every chat using
          it.
        </p>
        <fieldset disabled={busy}>
          <legend>Selected tags</legend>
          {tags.map((tag) => (
            <div className="row" key={tag.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(tag.id)}
                  onChange={(event) => {
                    setSelected(
                      event.target.checked
                        ? [...selected, tag.id]
                        : selected.filter((id) => id !== tag.id),
                    );
                  }}
                />{' '}
                {tag.name}
              </label>
              <button
                className="button"
                aria-label={`Edit tag ${tag.name}`}
                onClick={() => {
                  setEditing(tag);
                  setName(tag.name);
                  setDeleting(false);
                }}
              >
                Edit
              </button>
            </div>
          ))}
          {!tags.length && <p className="muted">Create your first tag below.</p>}
        </fieldset>
        <label>
          {editing ? 'Rename label' : 'New tag'}
          <input
            aria-label={editing ? 'Rename label' : 'New tag'}
            value={name}
            maxLength={40}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="row">
          <button
            className="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              void act(async () => {
                const tag = editing
                  ? await desktop().renameTag(editing.id, name)
                  : await desktop().createTag(name);
                const all = await desktop().tags();
                if (currentId.current !== conversationId) return;
                setTags(all);
                if (!editing)
                  setSelected((selected) =>
                    selected.includes(tag.id) ? selected : [...selected, tag.id],
                  );
                setName('');
                setEditing(null);
                setDeleting(false);
                await onChanged?.();
              })
            }
          >
            {editing ? 'Rename everywhere' : 'Create tag'}
          </button>
          {editing && (
            <>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setName('');
                  setDeleting(false);
                }}
              >
                Cancel label edit
              </button>
              <button className="button" disabled={busy} onClick={() => setDeleting(true)}>
                Delete label…
              </button>
            </>
          )}
        </div>
        {editing && deleting && (
          <div>
            <p>
              Delete “{editing.name}” from all conversations? Conversation content is preserved.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const id = editing.id;
                  await desktop().deleteTag(id);
                  const all = await desktop().tags();
                  if (currentId.current !== conversationId) return;
                  setTags(all);
                  setSelected((selected) => selected.filter((tagId) => tagId !== id));
                  setEditing(null);
                  setDeleting(false);
                  setName('');
                  await onChanged?.();
                })
              }
            >
              Delete label everywhere
            </button>
          </div>
        )}
        <p role="status">{error || (busy ? 'Updating tags…' : '')}</p>
        <button
          className="button primary"
          disabled={busy || !loaded || selected.length > 20}
          onClick={() =>
            void act(async () => {
              await desktop().setConversationTags(conversationId, selected);
              await onChanged?.();
            }, onClose)
          }
        >
          Save conversation tags
        </button>
        {selected.length > 20 && <p role="alert">Choose at most 20 tags.</p>}
      </div>
    </Dialog>
  );
}

export function PromptLibrary({
  projectId,
  draftKey,
  text,
  onApply,
  onClose,
}: {
  projectId?: string;
  draftKey: string;
  text: string;
  onApply: (
    expectedKey: string,
    expectedText: string,
    nextText: string,
  ) => Promise<boolean> | boolean;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<PromptTemplateInput | null>(null);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const context = useRef(projectId);
  context.current = projectId;
  useEffect(() => {
    let active = true;
    setTemplates([]);
    setEditing(null);
    setPreview(null);
    setDeleting(false);
    setBusy(true);
    setError('');
    void desktop()
      .promptTemplates(projectId)
      .then((data) => {
        if (active) setTemplates(data);
      })
      .catch((error) => {
        if (active) setError(errorText(error));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  async function act(operation: () => Promise<void>) {
    const scope = projectId;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      if (context.current === scope) setError(errorText(error));
    } finally {
      if (context.current === scope) setBusy(false);
    }
  }
  const visible = templates.filter((template) =>
    `${template.name}\n${template.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog title="Prompt library" wide onClose={onClose}>
      <div className="dialogBody">
        <p className="muted">
          Reusable prompt text. Applying a template preserves attachments, context selection and
          provider controls. Sending is a separate action.
        </p>
        {!editing && !preview && (
          <>
            <input
              aria-label="Find prompt templates"
              placeholder="Find a prompt…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="row">
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setError('');
                  setEditing({ name: '', body: '', projectId: projectId ?? null });
                }}
              >
                New template
              </button>
              <button
                className="button"
                disabled={busy || !text.trim()}
                onClick={() => {
                  setError('');
                  setEditing({ name: '', body: text, projectId: projectId ?? null });
                }}
              >
                Save draft as template
              </button>
            </div>
            {visible.map((template) => (
              <div className="historyResult" key={template.id}>
                <strong>{template.name}</strong>
                <small>{template.projectId ? 'Current project' : 'All projects'}</small>
                <p style={{ whiteSpace: 'pre-wrap' }}>
                  {template.body.slice(0, 240)}
                  {template.body.length > 240 ? '…' : ''}
                </p>
                <div className="row">
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      setError('');
                      setPreview({
                        draftKey,
                        originalText: text,
                        body: template.body,
                        action: 'append',
                      });
                    }}
                  >
                    Preview application
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      setError('');
                      setEditing(template);
                      setDeleting(false);
                    }}
                  >
                    Edit {template.name}
                  </button>
                </div>
              </div>
            ))}
            {!busy && !visible.length && <p className="muted">No matching prompt templates.</p>}
          </>
        )}
        {editing && (
          <>
            <label>
              Template name
              <input
                aria-label="Template name"
                disabled={busy}
                maxLength={100}
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </label>
            <label>
              Prompt text
              <textarea
                aria-label="Template prompt text"
                disabled={busy}
                rows={8}
                maxLength={100000}
                value={editing.body}
                onChange={(event) => setEditing({ ...editing, body: event.target.value })}
              />
            </label>
            <label>
              Available in
              <select
                aria-label="Template scope"
                disabled={busy}
                value={editing.projectId ?? ''}
                onChange={(event) =>
                  setEditing({ ...editing, projectId: event.target.value || null })
                }
              >
                <option value="">All projects</option>
                {projectId && <option value={projectId}>Current project</option>}
              </select>
            </label>
            <div className="row">
              <button
                className="button primary"
                disabled={busy || !editing.name.trim() || !editing.body.trim()}
                onClick={() =>
                  void act(async () => {
                    const input: PromptTemplateInput = {
                      id: editing.id,
                      revision: editing.revision,
                      name: editing.name,
                      body: editing.body,
                      projectId: editing.projectId,
                    };
                    await desktop().savePromptTemplate(input);
                    const data = await desktop().promptTemplates(projectId);
                    if (context.current === projectId) {
                      setTemplates(data);
                      setEditing(null);
                      setDeleting(false);
                    }
                  })
                }
              >
                Save template
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setDeleting(false);
                }}
              >
                Cancel edit
              </button>
              {editing.id && (
                <button className="button" disabled={busy} onClick={() => setDeleting(true)}>
                  Delete template…
                </button>
              )}
            </div>
            {deleting && editing.id && (
              <>
                <p>Delete “{editing.name}” from the prompt library?</p>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await desktop().deletePromptTemplate(editing.id!, editing.revision!);
                      const data = await desktop().promptTemplates(projectId);
                      if (context.current === projectId) {
                        setTemplates(data);
                        setEditing(null);
                        setDeleting(false);
                      }
                    })
                  }
                >
                  Delete template
                </button>
              </>
            )}
          </>
        )}
        {preview && (
          <>
            <fieldset disabled={busy}>
              <legend>Apply prompt text</legend>
              <label>
                <input
                  type="radio"
                  name="template-action"
                  checked={preview.action === 'append'}
                  onChange={() => setPreview({ ...preview, action: 'append' })}
                />{' '}
                Append to draft
              </label>
              <label>
                <input
                  type="radio"
                  name="template-action"
                  checked={preview.action === 'replace'}
                  onChange={() => setPreview({ ...preview, action: 'replace' })}
                />{' '}
                Replace draft text
              </label>
            </fieldset>
            <label>
              Resulting draft
              <textarea
                aria-label="Template application preview"
                readOnly
                value={templatePreviewText(preview)}
                rows={10}
              />
            </label>
            <div className="row">
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const next = applyTemplatePreview(preview, draftKey, text);
                    if (!(await onApply(preview.draftKey, preview.originalText, next)))
                      throw new Error(
                        'The conversation or draft changed. Preview the template again before applying it.',
                      );
                    onClose();
                  })
                }
              >
                Apply to draft
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setError('');
                }}
              >
                Back to library
              </button>
            </div>
          </>
        )}
        <p role="status">{error || (busy ? 'Updating prompt library…' : '')}</p>
      </div>
    </Dialog>
  );
}

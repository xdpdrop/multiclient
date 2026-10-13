import { useEffect, useState } from 'react';
import { useApp } from '../state';
import type { Draft, Project } from '../../shared/types';
import { Markdown } from '../components/Markdown';

export function ProjectTools({
  project,
  draft,
  onSaved,
}: {
  project: Project;
  draft: Draft;
  onSaved: (defaults: Partial<Draft>) => Promise<void>;
}) {
  const { snapshot, report, refresh, set, select } = useApp();
  const [prompt, setPrompt] = useState('');
  const [sourceRef, setSourceRef] = useState('HEAD');
  const [instructions, setInstructions] = useState<{ path: string; content: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [promptReady, setPromptReady] = useState(false);
  useEffect(() => {
    let active = true;
    setPromptReady(false);
    void Promise.all([
      window.desktop.projectDefaults(project.id),
      project.kind === 'folder' ? window.desktop.instructions(project.id) : Promise.resolve([]),
    ])
      .then(([defaults, files]) => {
        if (!active) return;
        // Playwright fill selects the current text, then insertText runs in a
        // later turn. Hydrating an empty field in that gap moves the caret to
        // the end, so the new text is appended to the saved prompt.
        setPrompt(defaults.text ?? '');
        setInstructions(files);
        setPromptReady(true);
      })
      .catch((error) => {
        if (active) setPromptReady(true);
        report(error);
      });
    return () => {
      active = false;
    };
  }, [project.id]);
  return (
    <section className="projectDefaults">
      <h4>New conversation defaults</h4>
      <p className="muted small">
        Save the current provider, model and reasoning depth for this project.
      </p>
      <label>
        Reusable starter prompt
        <textarea
          aria-label="Reusable starter prompt"
          value={prompt}
          disabled={!promptReady}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />
      </label>
      <button
        className="button"
        disabled={busy || !promptReady}
        onClick={() => {
          setBusy(true);
          const defaults = {
            provider: draft.provider,
            model: draft.model,
            effort: draft.effort,
            mode: draft.mode === 'code-bypass' ? 'code' : draft.mode,
            text: prompt,
          };
          void window.desktop
            .saveProjectDefaults(project.id, defaults)
            .then(() => onSaved(defaults))
            .then(() => setNotice('Defaults saved for new conversations.'))
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        Save project defaults
      </button>
      {project.kind === 'folder' && (
        <>
          <h4>Project instruction files</h4>
          <p className="muted small">
            These project files are shown without modification. Providers may also apply their own
            user or parent-directory configuration.
          </p>
          {instructions.length ? (
            instructions.map((file) => (
              <details key={file.path}>
                <summary>{file.path}</summary>
                <Markdown text={file.content} />
              </details>
            ))
          ) : (
            <p className="muted small">No project-root instruction files found.</p>
          )}
          <h4>Isolated coding workspace</h4>
          <p className="muted small">
            Create a separate checkout from a committed local reference. Uncommitted source changes
            stay in the primary checkout.
          </p>
          <label>
            Starting branch or commit
            <input
              aria-label="Starting branch or commit"
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
            />
          </label>
          <button
            className="button"
            disabled={busy || !project.trusted || !sourceRef.trim()}
            onClick={() => {
              setBusy(true);
              void window.desktop
                .createWorktree(project.id, sourceRef)
                .then(async (w) => {
                  set({ projectId: project.id, workspaceId: w.id });
                  await select(null);
                  await refresh();
                  setNotice(`Created ${w.branch}. Choose it in the Workspace menu.`);
                })
                .catch(report)
                .finally(() => setBusy(false));
            }}
          >
            Create worktree
          </button>
          {(snapshot?.workspaces ?? [])
            .filter((w) => w.projectId === project.id && w.kind === 'worktree')
            .map((w) => (
              <div className="historyResult" key={w.id}>
                <strong>
                  {w.branch}
                  {w.archived ? ' · archived' : ''}
                </strong>
                <small>{w.path}</small>
                {w.archived ? (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void window.desktop
                        .restoreWorkspace(w.id)
                        .then(refresh)
                        .then(() =>
                          setNotice('Workspace restored. Its saved checkout is available.'),
                        )
                        .catch(report)
                        .finally(() => setBusy(false));
                    }}
                  >
                    Restore workspace
                  </button>
                ) : (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void window.desktop
                        .archiveWorkspace(w.id)
                        .then(refresh)
                        .then(() =>
                          setNotice('Workspace archived. Its checkout and branch are preserved.'),
                        )
                        .catch(report)
                        .finally(() => setBusy(false));
                    }}
                  >
                    Archive workspace (preserve files)
                  </button>
                )}
              </div>
            ))}
        </>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}

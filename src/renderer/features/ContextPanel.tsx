import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, File, Folder, RefreshCw, X, GitBranch, Plus } from 'lucide-react';
import { useApp } from '../state';
import type { FileEntry, GitState, GitFileChange, Project } from '../../shared/types';

export function ContextPanel({
  project,
  onAttach,
  onReview,
}: {
  project?: Project;
  onAttach: (file: { path: string; content: string }) => void;
  onReview?: (file: { path: string; content: string }) => void;
}) {
  const { panel, set, report } = useApp();
  const [directory, setDirectory] = useState({ projectId: project?.id, path: '' });
  const path = directory.projectId === project?.id ? directory.path : '';
  const [fileData, setFileData] = useState<{ identity: string; entries: FileEntry[] } | null>(null);
  const [fileFilter, setFileFilter] = useState('');
  const [preview, setPreview] = useState<{
    projectId: string;
    path: string;
    content: string;
  } | null>(null);
  const [gitData, setGitData] = useState<{
    identity: string;
    state: GitState & { files?: GitFileChange[] };
  } | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  const identity = useRef('');
  identity.current = `${project?.id}:${panel}:${path}`;
  const files = fileData?.identity === identity.current ? fileData.entries : [];
  const git = gitData?.identity === identity.current ? gitData.state : null;
  const currentPreview = preview?.projectId === project?.id ? preview : null;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target = previous?.closest('details')?.querySelector('summary') ?? previous;
    panelRef.current?.focus();
    return () => {
      if (target?.isConnected) target.focus();
    };
  }, []);

  async function refresh() {
    if (!project) return;
    const token = ++request.current;
    const context = identity.current;
    setBusy(true);
    setError('');
    try {
      if (panel === 'files') {
        if (currentPreview) {
          const content = await window.desktop.readFile(project.id, currentPreview.path);
          if (token === request.current && context === identity.current)
            setPreview({ ...currentPreview, content });
        } else {
          const result = await window.desktop.files(project.id, path);
          if (token === request.current && context === identity.current)
            setFileData({ identity: context, entries: result });
        }
      } else {
        const result = await window.desktop.git(project.id);
        if (token === request.current && context === identity.current)
          setGitData({ identity: context, state: result });
      }
    } catch (failure) {
      if (token === request.current && context === identity.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (token === request.current && context === identity.current) setBusy(false);
    }
  }

  useEffect(() => {
    setPreview(null);
    setFileData(null);
    setGitData(null);
    setSelectedPath('');
    setError('');
  }, [project?.id]);
  useEffect(() => {
    setFileFilter('');
    void refresh();
    return () => {
      request.current++;
    };
  }, [project?.id, panel, path]);
  const visibleFiles = files.filter((file) =>
    file.name.toLowerCase().includes(fileFilter.toLowerCase()),
  );

  async function openFile(file: FileEntry) {
    if (!project) return;
    if (file.directory) {
      setPreview(null);
      setDirectory({ projectId: project.id, path: file.path });
      return;
    }
    const token = ++request.current;
    const context = identity.current;
    setBusy(true);
    setError('');
    try {
      const content = await window.desktop.readFile(project.id, file.path);
      if (token === request.current && context === identity.current)
        setPreview({ projectId: project.id, path: file.path, content });
    } catch (failure) {
      if (token === request.current && context === identity.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (token === request.current && context === identity.current) setBusy(false);
    }
  }

  const selected = git?.files?.find((file) => file.path === selectedPath) ?? git?.files?.[0];
  const selectedDiff =
    selected &&
    (['staged', 'unstaged', 'untracked'] as const)
      .flatMap((section) =>
        selected[section]?.kind === 'text' && selected[section]?.text
          ? [`${section.toUpperCase()}\n${selected[section]!.text}`]
          : [],
      )
      .join('\n\n');

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="contextPanel"
      aria-label="Project context"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          set({ panel: null });
        }
      }}
    >
      <header>
        <div className="tabRow" role="tablist" aria-label="Project context">
          <button
            role="tab"
            aria-selected={panel === 'files'}
            className={panel === 'files' ? 'active' : ''}
            onClick={() => set({ panel: 'files' })}
          >
            Files
          </button>
          <button
            role="tab"
            aria-selected={panel === 'git'}
            className={panel === 'git' ? 'active' : ''}
            onClick={() => set({ panel: 'git' })}
          >
            Changes
          </button>
        </div>
        <button
          className="iconButton"
          aria-label="Refresh panel"
          disabled={busy || !project}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
        </button>
        <button
          className="iconButton"
          aria-label="Close panel"
          onClick={() => set({ panel: null })}
        >
          <X size={16} />
        </button>
      </header>
      {!project ? (
        <div className="panelEmpty">Choose a project to see its files and changes.</div>
      ) : (
        <>
          {busy && (
            <p className="panelStatus" role="status">
              Loading {panel === 'files' ? 'files' : 'changes'}…
            </p>
          )}
          {error && (
            <div className="panelStatus" role="alert">
              <p>{error}</p>
              <button className="button" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {panel === 'files' ? (
            <>
              <div className="pathRow">
                <button
                  className="iconButton"
                  aria-label="Parent directory"
                  disabled={!path && !currentPreview}
                  onClick={() => {
                    request.current++;
                    setBusy(false);
                    setError('');
                    if (currentPreview) setPreview(null);
                    else
                      setDirectory({
                        projectId: project.id,
                        path: path.split(/[\\/]/).slice(0, -1).join('/'),
                      });
                  }}
                >
                  <ArrowLeft size={15} />
                </button>
                <span>{currentPreview?.path ?? (path || project.name)}</span>
              </div>
              {currentPreview ? (
                <>
                  <button
                    className="button attachButton"
                    onClick={() =>
                      window.desktop.openFile(project.id, currentPreview.path).catch(report)
                    }
                  >
                    Open file
                  </button>
                  <button
                    className="button attachButton"
                    onClick={() =>
                      onAttach({ path: currentPreview.path, content: currentPreview.content })
                    }
                  >
                    <Plus size={15} /> Attach this file
                  </button>
                  <pre className="filePreview">{currentPreview.content}</pre>
                </>
              ) : (
                <div className="fileList">
                  <input
                    className="fileFilter"
                    aria-label="Filter files"
                    placeholder="Filter this directory…"
                    value={fileFilter}
                    onChange={(event) => setFileFilter(event.target.value)}
                  />
                  {visibleFiles.map((file) => (
                    <button key={file.path} onClick={() => void openFile(file)}>
                      {file.directory ? <Folder size={15} /> : <File size={15} />}
                      <span>{file.name}</span>
                    </button>
                  ))}
                  {!visibleFiles.length && !busy && !error && (
                    <p className="muted small">
                      {fileFilter
                        ? 'No matching files in this directory.'
                        : 'No files in this directory.'}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="gitPanel">
              {git?.error ? (
                <p role="alert">{git.error}</p>
              ) : (
                git && (
                  <>
                    <div className="branch">
                      <GitBranch size={15} />
                      {git.branch}
                    </div>
                    {git.diff && (
                      <button
                        className="button attachButton"
                        disabled={git.diff.length > 100000}
                        title={
                          git.diff.length > 100000
                            ? 'Select an individual file to attach a smaller diff.'
                            : undefined
                        }
                        onClick={() => onAttach({ path: 'git-changes.diff', content: git.diff })}
                      >
                        <Plus size={15} /> Attach captured changes
                      </button>
                    )}
                    {git.diff && onReview && (
                      <button
                        className="button attachButton"
                        disabled={git.diff.length > 100000}
                        onClick={() => onReview({ path: 'git-changes.diff', content: git.diff })}
                      >
                        Review captured changes
                      </button>
                    )}
                    <div className="gitFileList">
                      {git.entries.map((file) => (
                        <button
                          className={`gitFile ${selected?.path === file.path ? 'selected' : ''}`}
                          key={file.path}
                          aria-pressed={selected?.path === file.path}
                          onClick={() => setSelectedPath(file.path)}
                        >
                          <code>{file.status}</code>
                          <span>{file.path}</span>
                        </button>
                      ))}
                    </div>
                    {!git.entries.length && !busy && (
                      <p className="muted small">Working tree is clean.</p>
                    )}
                    {selected && <h3 className="diffHeading">{selected.path}</h3>}
                    {selected && !selected.status.includes('D') && (
                      <button
                        className="button attachButton"
                        onClick={() =>
                          window.desktop.openFile(project.id, selected.path).catch(report)
                        }
                      >
                        Open changed file
                      </button>
                    )}
                    {selectedDiff && (
                      <button
                        className="button attachButton"
                        disabled={selectedDiff.length > 100000}
                        onClick={() =>
                          onAttach({ path: `${selected!.path}.diff`, content: selectedDiff })
                        }
                      >
                        <Plus size={15} /> Attach file changes
                      </button>
                    )}
                    {selectedDiff && onReview && (
                      <button
                        className="button attachButton"
                        disabled={selectedDiff.length > 100000}
                        onClick={() =>
                          onReview({ path: `${selected!.path}.diff`, content: selectedDiff })
                        }
                      >
                        Review selected file
                      </button>
                    )}
                    {selected &&
                      (['staged', 'unstaged', 'untracked'] as const).map((section) => {
                        const value = selected[section];
                        if (!value) return null;
                        return (
                          <section className="diffSection" key={section}>
                            <h4>
                              {section === 'untracked'
                                ? 'New file'
                                : section === 'staged'
                                  ? 'Staged changes'
                                  : 'Unstaged changes'}
                            </h4>
                            {value.kind !== 'text' ? (
                              <p className="muted small">{value.detail}</p>
                            ) : value.text ? (
                              <pre className="diff">
                                {value.text.split('\n').map((line, index) => (
                                  <span
                                    className={
                                      line.startsWith('+')
                                        ? 'diffAdded'
                                        : line.startsWith('-')
                                          ? 'diffRemoved'
                                          : line.startsWith('@@')
                                            ? 'diffHunk'
                                            : ''
                                    }
                                    key={index}
                                  >
                                    {line}
                                    {'\n'}
                                  </span>
                                ))}
                              </pre>
                            ) : (
                              <p className="muted small">No text changes in this section.</p>
                            )}
                          </section>
                        );
                      })}
                    {!git.files && git.diff && <pre className="diff">{git.diff}</pre>}
                  </>
                )
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

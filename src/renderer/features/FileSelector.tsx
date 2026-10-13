import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import type { Attachment, FileEntry } from '../../shared/types';

export function FileSelector({
  workspaceId,
  onAttach,
  onClose,
}: {
  workspaceId: string;
  onAttach: (file: Attachment) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const readGeneration = useRef(0);
  useEffect(() => {
    readGeneration.current++;
    setFiles([]);
    setReading(false);
    return () => {
      readGeneration.current++;
    };
  }, [workspaceId]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true);
      void window.desktop
        .findFiles(workspaceId, query)
        .then((result) => {
          if (active) setFiles(result);
        })
        .catch((e) => {
          if (active) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [workspaceId, query]);
  return (
    <Dialog title="Attach a project file" onClose={onClose}>
      <div className="dialogBody">
        <input
          autoFocus
          aria-label="Find a project file"
          value={query}
          placeholder="Search file paths…"
          onChange={(e) => {
            setQuery(e.target.value);
            setError('');
          }}
        />
        <p className="muted small">
          Text snapshots up to 100 KB. Search is bounded to 5,000 entries and 100 results;
          dependency and credential paths are excluded. Use Attach files for images and PDFs.
        </p>
        {(busy || reading) && <p role="status">{reading ? 'Reading file…' : 'Finding files…'}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="pdfPages">
          {files.map((file) => (
            <button
              key={file.path}
              className="historyResult"
              disabled={busy || reading}
              onClick={() => {
                const generation = ++readGeneration.current;
                setReading(true);
                void window.desktop
                  .readFile(workspaceId, file.path)
                  .then((content) => {
                    if (generation !== readGeneration.current) return;
                    onAttach({ path: file.path, content, kind: 'text' });
                    onClose();
                  })
                  .catch((e) => {
                    if (generation === readGeneration.current)
                      setError(e instanceof Error ? e.message : String(e));
                  })
                  .finally(() => {
                    if (generation === readGeneration.current) setReading(false);
                  });
              }}
            >
              {file.path}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

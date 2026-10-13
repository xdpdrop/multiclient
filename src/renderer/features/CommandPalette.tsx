import { useState } from 'react';
import { Dialog } from '../components/Dialog';

export function CommandPalette({
  actions,
  onClose,
}: {
  actions: { label: string; run: () => void }[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <Dialog title="Commands" onClose={onClose}>
      <div className="dialogBody">
        <input
          autoFocus
          aria-label="Find a command"
          value={query}
          placeholder="Type a command…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered[0]) {
              e.preventDefault();
              filtered[0].run();
              onClose();
            }
          }}
        />
        <div className="commandActions">
          {filtered.map((a) => (
            <button
              key={a.label}
              className="button"
              onClick={() => {
                a.run();
                onClose();
              }}
            >
              {a.label}
            </button>
          ))}
          {!filtered.length && <p role="status">No matching command.</p>}
        </div>
      </div>
    </Dialog>
  );
}

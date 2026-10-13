import { ExternalLink } from 'lucide-react';
import type { ConnectionUsage as Usage, ProviderId } from '../../shared/types';

export function ConnectionUsage({
  provider,
  usage,
  onError,
}: {
  provider: ProviderId;
  usage?: Usage;
  onError: (error: unknown) => void;
}) {
  const url =
    provider === 'codex'
      ? 'https://chatgpt.com/codex/settings/usage'
      : provider === 'claude-code'
        ? 'https://claude.ai/settings/usage'
        : 'https://cursor.com/dashboard';
  return (
    <div className="connectionUsage">
      {usage?.windows.map((window) => (
        <div className="usageWindow" key={window.id}>
          <div className="row spread">
            <span>{window.label}</span>
            <strong>{Math.round(window.remainingPercent)}% remaining</strong>
          </div>
          <progress
            aria-label={`${window.label} remaining usage`}
            value={window.remainingPercent}
            max={100}
          />
          {window.resetsAt !== undefined && (
            <small>
              {window.resetsAt * 1000 <= Date.now()
                ? 'Reset due · refresh for current limits'
                : `Resets ${new Date(window.resetsAt * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
            </small>
          )}
        </div>
      ))}
      <div className="usageFooter">
        <span>
          {usage?.windows.length
            ? `Last checked ${new Date(usage.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : provider === 'codex'
              ? 'Usage temporarily unavailable'
              : 'Remaining usage isn’t exposed here'}
        </span>
        <button
          type="button"
          className="textButton"
          onClick={() => window.desktop.openExternal(url).catch(onError)}
        >
          View usage <ExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}

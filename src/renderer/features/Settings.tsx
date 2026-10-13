import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  RefreshCw,
  ExternalLink,
  ImagePlus,
  Trash2,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { Dialog } from '../components/Dialog';
import { ProviderIcon } from '../components/ProviderIcon';
import { ConnectionUsage } from '../components/ConnectionUsage';
import { useApp } from '../state';
import type { Appearance, Connection, ModelOption } from '../../shared/types';
import { isProviderAvailable } from '../../shared/defaults';
import { localEndpointPresets, supportsNativeAttachment } from '../../shared/models';
export function Settings() {
  const { snapshot, set, report, refresh } = useApp();
  const [tab, setTab] = useState<'connections' | 'appearance' | 'about'>('connections');
  const [busy, setBusy] = useState(false);
  const [appearanceDraft, setAppearanceDraft] = useState(snapshot?.settings.appearance);
  const pendingAppearance = useRef<Partial<Appearance>>({});
  const appearanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const appearanceQueue = useRef(Promise.resolve());
  function flushAppearance() {
    clearTimeout(appearanceTimer.current);
    const patch = pendingAppearance.current;
    pendingAppearance.current = {};
    if (!Object.keys(patch).length) return;
    appearanceQueue.current = appearanceQueue.current
      .then(async () => {
        await window.desktop.settingsPatch({ appearance: patch });
        await refresh();
      })
      .catch(report);
  }
  useEffect(() => () => flushAppearance(), []);
  useEffect(() => {
    const check = () => {
      void probe();
    };
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);
  if (!snapshot) return null;
  async function probe() {
    setBusy(true);
    try {
      await window.desktop.probe();
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function appearance(value: Partial<Appearance>) {
    const next = { ...(appearanceDraft ?? snapshot!.settings.appearance), ...value };
    setAppearanceDraft(next);
    pendingAppearance.current = { ...pendingAppearance.current, ...value };
    clearTimeout(appearanceTimer.current);
    appearanceTimer.current = setTimeout(flushAppearance, 150);
  }
  const a = appearanceDraft ?? snapshot.settings.appearance;
  return (
    <Dialog title="Settings" wide onClose={() => set({ settingsOpen: false })}>
      <div className="settingsLayout">
        <nav className="settingsNav">
          {(['connections', 'appearance', 'about'] as const).map((t) => (
            <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        <div className="settingsContent">
          {tab === 'connections' && (
            <>
              <div className="sectionHeading">
                <div>
                  <h3>Your AI connections</h3>
                  <p>Choose which tools appear in your provider menu.</p>
                </div>
                <button
                  className="iconButton"
                  aria-label="Refresh connections"
                  disabled={busy}
                  onClick={() => void probe()}
                >
                  <RefreshCw size={17} className={busy ? 'spin' : ''} />
                </button>
              </div>
              <div className="notice">
                Refresh checks configuration and CLI sign-in without sending a prompt. API keys are
                billed separately from subscriptions. Test connection sends a small request.
              </div>
              {snapshot.connections
                .filter((c) => c.id !== 'demo' && isProviderAvailable(c.id))
                .map((c) => (
                  <ConnectionCard key={c.id} connection={c} checking={busy} />
                ))}
            </>
          )}
          {tab === 'appearance' && (
            <>
              <h3>Make yourself at home</h3>
              <p className="muted">A quiet space, with your own point of view.</p>
              <div className="themeGrid">
                {(
                  [
                    ['light', Sun],
                    ['dark', Moon],
                    ['system', Monitor],
                  ] as const
                ).map(([theme, Icon]) => (
                  <button
                    key={theme}
                    className={`themeChoice ${a.theme === theme ? 'active' : ''}`}
                    onClick={() => void appearance({ theme })}
                  >
                    <Icon size={25} />
                    <span>{theme[0].toUpperCase() + theme.slice(1)}</span>
                    {a.theme === theme && <Check size={14} />}
                  </button>
                ))}
              </div>
              <h4>Background</h4>
              <p className="muted small">Choose a local image, GIF, MP4 or WebM. Up to 100 MB.</p>
              <div className="row">
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      const asset = await window.desktop.importBackground();
                      if (asset)
                        await appearance({ background: asset.id, backgroundType: asset.type });
                    } catch (e) {
                      report(e);
                    }
                  }}
                >
                  <ImagePlus size={16} /> Choose background
                </button>
                {a.background && (
                  <button
                    className="iconButton"
                    aria-label="Remove background"
                    onClick={() => void appearance({ background: null })}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <h4>Reading and notifications</h4>
              <label>
                Text size
                <input
                  type="range"
                  min="12"
                  max="24"
                  value={snapshot.settings.fontSize ?? 16}
                  onChange={(event) =>
                    void window.desktop
                      .settingsPatch({ fontSize: Number(event.target.value) })
                      .then(refresh)
                      .catch(report)
                  }
                />
                <output>{snapshot.settings.fontSize ?? 16} px</output>
              </label>
              <label>
                Display density
                <select
                  value={snapshot.settings.density ?? 'comfortable'}
                  onChange={(event) =>
                    void window.desktop
                      .settingsPatch({ density: event.target.value as 'comfortable' | 'compact' })
                      .then(refresh)
                      .catch(report)
                  }
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={snapshot.settings.notifications ?? false}
                  onChange={(event) =>
                    void window.desktop
                      .settingsPatch({ notifications: event.target.checked })
                      .then(refresh)
                      .catch(report)
                  }
                />
                Notify me when a background conversation finishes or needs attention
              </label>
              <div className="sliders">
                {(
                  [
                    {
                      key: 'backgroundOpacity',
                      label: 'Background opacity',
                      max: 1,
                      min: 0,
                      step: 0.01,
                    },
                    {
                      key: 'surfaceOpacity',
                      label: 'Surface opacity',
                      max: 1,
                      min: 0.35,
                      step: 0.01,
                    },
                    { key: 'dimming', label: 'Background dimming', max: 0.9, min: 0, step: 0.01 },
                    { key: 'blur', label: 'Background blur', max: 32, min: 0, step: 1 },
                  ] as const
                ).map((s) => (
                  <label key={s.key}>
                    <span>
                      {s.label}
                      <output>
                        {s.key === 'blur' ? `${a[s.key]} px` : `${Math.round(a[s.key] * 100)}%`}
                      </output>
                    </span>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={a[s.key]}
                      onChange={(event) => void appearance({ [s.key]: Number(event.target.value) })}
                    />
                  </label>
                ))}
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={a.reducedMotion}
                  onChange={(e) => void appearance({ reducedMotion: e.target.checked })}
                />{' '}
                Reduce motion and pause animated backgrounds
              </label>
              <div className="row">
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      const theme = await window.desktop.importTheme();
                      if (theme) await appearance(theme);
                    } catch (e) {
                      report(e);
                    }
                  }}
                >
                  Import theme
                </button>
                <button
                  className="button"
                  onClick={() => window.desktop.exportTheme(a).catch(report)}
                >
                  Export theme
                </button>
              </div>
            </>
          )}
          {tab === 'about' && (
            <>
              <div className="aboutMark">
                m<span>✳</span>
              </div>
              <h3>Multiclient</h3>
              <p>A place for all your AI tools.</p>
              <p className="muted">Version 0.1.0 · Development preview</p>
              <hr />
              <p>
                Conversations stay on this device. Prompts and selected context are sent to the
                provider you choose. There is no Multiclient cloud or telemetry.
              </p>
              <p>
                Credentials for subscription tools stay with their official CLIs. API keys use
                secure OS storage when available, or memory for this session.
              </p>
              <p className="muted small">
                Local conversation history is not encrypted. Stopping a turn does not undo completed
                actions. This app is an independent open-source project.
              </p>
              <button
                className="button"
                onClick={() => window.desktop.exportDiagnostics().catch(report)}
              >
                Export diagnostics
              </button>
              <p className="muted small">
                Versions and request timings only. Prompts, file paths and keys are excluded.
              </p>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
function ConnectionCard({ connection, checking }: { connection: Connection; checking: boolean }) {
  const { snapshot, refresh, report } = useApp();
  const [draft, setDraft] = useState(connection);
  const [key, setKey] = useState('');
  const [persist, setPersist] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => {
    setDraft(connection);
  }, [
    connection.id,
    connection.executable,
    connection.endpoint,
    connection.model,
    connection.configured,
  ]);
  useEffect(() => {
    setDraft((previous) => ({ ...previous, enabled: connection.enabled }));
  }, [connection.enabled]);
  const status = snapshot?.availability.find((a) => a.id === connection.id);
  const cli = connection.kind === 'cli-agent';
  const nativeImages =
    status?.capabilities.inputKinds.includes('image') &&
    supportsNativeAttachment(connection.id, connection.model, 'image');
  const nativeDocuments =
    status?.capabilities.inputKinds.includes('pdf') &&
    supportsNativeAttachment(connection.id, connection.model, 'pdf');
  const state = !connection.enabled
    ? 'disabled'
    : checking
      ? 'checking'
      : (status?.status ?? 'unknown');
  const labels = {
    ready: 'Ready',
    'sign-in': 'Sign in required',
    'not-installed': 'Not installed',
    error: 'Check failed',
    unknown: 'Not verified',
    disabled: 'Disabled',
    checking: 'Checking…',
  };
  async function toggle() {
    setBusy(true);
    try {
      await window.desktop.saveConnection({ ...connection, enabled: !connection.enabled });
      await refresh();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await window.desktop.saveConnection(draft);
      if (key) {
        const saved = await window.desktop.saveCredential(connection.id, key, persist);
        setKey('');
        setMessage(
          saved.persisted
            ? 'API key saved securely.'
            : 'API key kept in memory until the app closes.',
        );
      } else setMessage('Connection saved.');
      await window.desktop.probe();
      await refresh();
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const docs =
    connection.id === 'codex'
      ? 'https://developers.openai.com/codex/cli'
      : connection.id === 'claude-code'
        ? 'https://code.claude.com/docs/en/setup'
        : 'https://cursor.com/docs/cli/installation';
  return (
    <section className="connectionCard" aria-label={`${connection.name} connection`}>
      <div className="connectionOverview">
        <button
          className="connectionSummary"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={`${connection.name} settings`}
        >
          <ProviderIcon provider={connection.id} />
          <span>
            <strong>{connection.name}</strong>
            <small
              className="connectionStatus"
              data-state={state}
              role="status"
              title={status?.detail}
            >
              <span className="statusDot" aria-hidden="true" />
              {labels[state]}
            </small>
          </span>
          <ChevronDown
            size={15}
            className={expanded ? 'connectionChevron expanded' : 'connectionChevron'}
          />
        </button>
        <button
          type="button"
          role="switch"
          aria-label={`Enable ${connection.name}`}
          aria-checked={connection.enabled}
          className="connectionSwitch"
          disabled={busy}
          onClick={() => void toggle()}
        >
          <span />
        </button>
      </div>
      {connection.enabled && status?.status === 'ready' && (
        <ConnectionUsage provider={connection.id} usage={status.usage} onError={report} />
      )}
      {expanded && (
        <div className="connectionDetail">
          {cli ? (
            <>
              <p className="small muted">
                {status?.detail ?? 'Refresh connections to check installation and sign-in.'}
                {status?.version && <span className="connectionVersion">{status.version}</span>}
              </p>
              <label>
                Executable path
                <input
                  value={draft.executable}
                  onChange={(e) => setDraft({ ...draft, executable: e.target.value })}
                  placeholder="Auto-detect official installation"
                />
              </label>
              <div className="row">
                <button
                  className="button"
                  disabled={busy || !status?.installed}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await window.desktop.login(connection.id);
                      setMessage(result.message);
                    } catch (e) {
                      report(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Sign in with official CLI
                </button>
                <button
                  className="textButton"
                  onClick={() => window.desktop.openExternal(docs).catch(report)}
                >
                  Install instructions <ExternalLink size={13} />
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="small muted">
                Key setup:{' '}
                {connection.configured
                  ? 'Key available.'
                  : 'No saved key. Loopback local servers can omit a key.'}
              </p>
              <div className="small notice">
                <strong>Last API request test: </strong>
                {status?.test ? (
                  <>
                    {status.test.passed ? 'Passed' : 'Failed'} ·{' '}
                    <time dateTime={status.test.checkedAt}>
                      {new Date(status.test.checkedAt).toLocaleString()}
                    </time>
                    <p>{status.test.detail}</p>
                  </>
                ) : (
                  'Not tested for the current saved configuration.'
                )}
              </div>
              {connection.id === 'compatible' && (
                <label>
                  Local server preset
                  <select
                    value=""
                    onChange={(event) => {
                      const preset = localEndpointPresets.find(
                        (p) => p.endpoint === event.target.value,
                      );
                      if (preset) setDraft({ ...draft, endpoint: preset.endpoint });
                    }}
                  >
                    <option value="">Choose a preset or enter a custom endpoint</option>
                    {localEndpointPresets.map((preset) => (
                      <option key={preset.label} value={preset.endpoint}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <small>
                    Start your separately installed local server first. Loopback servers can omit an
                    API key.
                  </small>
                </label>
              )}
              <label>
                API endpoint
                <input
                  value={draft.endpoint}
                  onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
                  placeholder="https://api.example.com/v1"
                />
              </label>
              <label>
                API key
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    connection.configured ? 'Leave blank to keep current key' : 'Enter your API key'
                  }
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={persist}
                  onChange={(e) => setPersist(e.target.checked)}
                />{' '}
                Remember using OS secure storage
              </label>
              {connection.configured && (
                <button
                  className="textButton"
                  onClick={async () => {
                    try {
                      await window.desktop.saveCredential(connection.id, '', false);
                      await refresh();
                    } catch (e) {
                      report(e);
                    }
                  }}
                >
                  Remove saved key
                </button>
              )}
            </>
          )}
          {status && (
            <div className="small muted">
              <p>
                Available modes: {status.capabilities.modes.map((mode) => mode.label).join(', ')}
              </p>
              <p>
                Images:{' '}
                {cli
                  ? 'Native CLI image input is not certified.'
                  : nativeImages
                    ? 'Native PNG, JPEG and WebP for the saved model.'
                    : 'Unavailable for the saved model.'}
              </p>
              <p>
                Documents:{' '}
                {nativeDocuments
                  ? 'Native PDF or extracted text for the saved model.'
                  : 'Extracted PDF text only.'}{' '}
                Selecting pages always sends extracted text.
              </p>
              {!cli && (
                <p>Choosing another model in a conversation can change native input support.</p>
              )}
            </div>
          )}
          <label>
            Default model
            <input
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder={cli ? 'Use CLI default' : 'Enter a model ID'}
            />
            {!cli && models.length > 0 && (
              <select
                aria-label={`${connection.name} discovered models`}
                value={models.some((model) => model.id === draft.model) ? draft.model : ''}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              >
                <option value="">Select an available model or keep the custom ID above</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            )}
          </label>
          <div className="row spread">
            <button className="button primary" disabled={busy} onClick={() => void save()}>
              Save connection
            </button>
            {!cli && (
              <>
                <button
                  className="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await save())) return;
                    setBusy(true);
                    try {
                      const found = await window.desktop.models(connection.id);
                      setModels(found);
                      setMessage(
                        found.length
                          ? `Found ${found.length} models. Select one and save the connection.`
                          : 'No models were listed. Enter a custom model ID.',
                      );
                    } catch (error) {
                      report(error);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Fetch models
                </button>
                <button
                  className="button"
                  disabled={busy || !draft.model}
                  onClick={async () => {
                    if (!(await save())) return;
                    setBusy(true);
                    try {
                      setMessage((await window.desktop.testConnection(connection.id)).message);
                      await refresh();
                    } catch (error) {
                      report(error);
                      await refresh().catch(report);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Test connection (uses tokens)
                </button>
              </>
            )}
          </div>
          {message && (
            <p className="small notice" role="status">
              {message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

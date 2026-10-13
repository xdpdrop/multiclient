import { useEffect, useRef, useState } from 'react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { X, TerminalSquare, Minus, RotateCcw } from 'lucide-react';
import { useApp } from '../state';

type TerminalSession = {
  term: Xterm;
  fit: FitAddon;
  element: HTMLDivElement;
  id?: string;
  status: string;
  exited: boolean;
  disposed: boolean;
  opening: Promise<void>;
  listeners: Set<() => void>;
  dispose(): void;
};
const sessions = new Map<string, TerminalSession>();

function sessionFor(projectId: string, report: (error: unknown) => void) {
  const existing = sessions.get(projectId);
  if (existing) return existing;
  const term = new Xterm({
    fontSize: 13,
    fontFamily: 'Cascadia Code, Menlo, monospace',
    cursorBlink: !matchMedia('(prefers-reduced-motion: reduce)').matches,
    scrollback: 3000,
    theme: { background: '#222320', foreground: '#e8e6df', cursor: '#c98b70' },
    allowProposedApi: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const element = document.createElement('div');
  element.className = 'terminalSession';
  const session: TerminalSession = {
    term,
    fit,
    element,
    status: 'Starting local shell…',
    exited: false,
    disposed: false,
    opening: Promise.resolve(),
    listeners: new Set(),
    dispose: () => {},
  };
  const notify = () => session.listeners.forEach((listener) => listener());
  const unsubscribe = window.desktop.onEvent((event) => {
    if (event.type === 'runtime-state' && event.status !== 'ready') {
      session.exited = true;
      session.status = 'Shell stopped during runtime recovery. Restart to open a new shell.';
      notify();
    }
    if (event.type === 'terminal' && event.terminalId === session.id) term.write(event.data);
    if (event.type === 'terminal-exit' && event.terminalId === session.id) {
      session.exited = true;
      session.status = `Shell exited (${event.code})`;
      notify();
    }
  });
  const data = term.onData((value) => {
    if (session.id && !session.exited)
      void window.desktop.terminalWrite(session.id, value).catch(report);
  });
  session.dispose = () => {
    session.disposed = true;
    sessions.delete(projectId);
    unsubscribe();
    data.dispose();
    term.dispose();
    if (session.id) void window.desktop.terminalClose(session.id).catch(report);
    session.listeners.clear();
  };
  session.opening = window.desktop
    .terminalOpen(projectId)
    .then((id) => {
      if (session.disposed) {
        void window.desktop.terminalClose(id).catch(report);
        return;
      }
      session.id = id;
      session.status = 'Local shell';
      notify();
    })
    .catch((error) => {
      session.exited = true;
      session.status = error instanceof Error ? error.message : String(error);
      notify();
    });
  sessions.set(projectId, session);
  return session;
}

export function Terminal({ projectId }: { projectId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { set, report } = useApp();
  const fontSize = useApp((state) => state.snapshot?.settings.fontSize ?? 16);
  const reducedMotion = useApp(
    (state) => state.snapshot?.settings.appearance.reducedMotion ?? false,
  );
  const [status, setStatus] = useState('Local shell');
  const [exited, setExited] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!projectId || !ref.current) return;
    const session = sessionFor(projectId, report);
    session.term.options.fontSize = Math.round(fontSize * 0.8125);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => {
      session.term.options.cursorBlink = !reducedMotion && !motion.matches;
    };
    updateMotion();
    motion.addEventListener('change', updateMotion);
    const container = ref.current;
    container.append(session.element);
    if (!session.term.element) session.term.open(session.element);
    const update = () => {
      setStatus(session.status);
      setExited(session.exited);
    };
    update();
    session.listeners.add(update);
    const resize = () => {
      if (session.disposed || !container.isConnected || !container.clientWidth) return;
      session.fit.fit();
      if (session.id && !session.exited)
        void window.desktop
          .terminalResize(session.id, session.term.cols, session.term.rows)
          .catch(report);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    void session.opening.then(() => {
      if (!container.isConnected || !session.element.isConnected) return;
      resize();
      session.term.focus();
    });
    resize();
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', updateMotion);
      session.listeners.delete(update);
      session.element.remove();
    };
  }, [projectId, generation, fontSize, reducedMotion]);
  return (
    <section className="terminalPanel" aria-label="Local terminal">
      <header>
        <span>
          <TerminalSquare size={14} /> <span role="status">{status}</span>
        </span>
        <span className="small muted">Commands you enter run directly on your machine</span>
        {projectId && exited && (
          <button
            className="iconButton"
            aria-label="Restart terminal"
            onClick={() => {
              sessions.get(projectId)?.dispose();
              setGeneration((value) => value + 1);
            }}
          >
            <RotateCcw size={16} />
          </button>
        )}
        <button
          className="iconButton"
          aria-label="Hide terminal"
          title="Hide terminal (keeps shell running)"
          onClick={() => set({ terminal: false })}
        >
          <Minus size={16} />
        </button>
        <button
          className="iconButton"
          aria-label="Close terminal"
          title="Close terminal and stop its shell"
          onClick={() => {
            if (projectId) sessions.get(projectId)?.dispose();
            set({ terminal: false });
          }}
        >
          <X size={16} />
        </button>
      </header>
      {projectId ? (
        <div ref={ref} className="terminalBody" />
      ) : (
        <p className="panelEmpty">Choose and trust a project to open a terminal.</p>
      )}
    </section>
  );
}

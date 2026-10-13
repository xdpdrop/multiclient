import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  Square,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Folder,
  MessageSquare,
  Settings as SettingsIcon,
  Search,
  SlidersHorizontal,
  Paperclip,
  FileText,
  GitBranch,
  TerminalSquare,
  X,
  ChevronDown,
  MoreHorizontal,
  Check,
  ShieldCheck,
  Copy,
} from 'lucide-react';
import { useApp } from './state';
import { newDraftContext, useComposerDraft } from './drafts';
import { KnowledgeLibrary } from './features/KnowledgeLibrary';
import { ContextManifest, SourceSnapshots } from './features/ContextManifest';
import { MemoryLibrary } from './features/MemoryLibrary';
import { WebSources } from './features/WebSources';
import { Artifacts, SaveArtifactButton } from './features/Artifacts';
import { TagPicker, PromptLibrary } from './features/Organization';
import { Comparison } from './features/Comparison';
import { planContextInclusion } from './features/context-inclusion';
import type { ContextRef, ContextSnapshot, ContextSnapshotSummary } from '../shared/context';
import type { ArtifactReference, ArtifactKind } from '../shared/artifacts';
import type { ComparisonInput } from '../shared/comparison';
import { QuestionFields, questionAnswersValid } from './components/QuestionFields';
import { HistoryBrowser } from './features/HistoryBrowser';
import { AttachmentPreview } from './features/Attachments';
import { ProjectTools } from './features/ProjectTools';
import { ContextSelection } from './features/ContextSelection';
import { CommandPalette } from './features/CommandPalette';
import { FileSelector } from './features/FileSelector';
import { modelCatalog, effortLabel, supportsNativeAttachment } from '../shared/models';
import { capabilities, isProviderAvailable } from '../shared/defaults';
import { isBypassMode } from '../shared/modes';
import { Settings } from './features/Settings';
import { ContextPanel } from './features/ContextPanel';
import { Terminal } from './features/Terminal';
import { Background } from './appearance/Background';
import { Markdown } from './components/Markdown';
import { Dialog } from './components/Dialog';
import { ProviderIcon } from './components/ProviderIcon';
import { Picker } from './components/Picker';
import { ModeControl } from './components/ModeControl';
import { MessageContent } from './components/MessageContent';
import type {
  Interaction,
  ProviderId,
  SendInput,
  Project,
  ModelOption,
  Attachment,
  Draft,
  QuestionAnswer,
  SearchResult,
  Conversation,
} from '../shared/types';
import styles from './App.module.css';

export function App() {
  const state = useApp();
  const { snapshot, view, selectedId, set, report, refresh, select } = state;
  const draftKey = selectedId ?? `new:${state.workspaceId ?? state.projectId ?? 'personal'}`;
  const composer = useComposerDraft(
    draftKey,
    {
      text: '',
      attachments: [],
      provider: view?.conversation.providerId ?? 'codex',
      model: view?.conversation.model ?? '',
      mode: view?.conversation.mode === 'code-bypass' ? 'code' : (view?.conversation.mode ?? 'ask'),
      effort: view?.conversation.effort ?? '',
      contextRefs: [
        ...new Map(
          (view?.messages ?? [])
            .flatMap((message) => message.contextSources ?? [])
            .filter((source) => source.kind === 'instructions')
            .map((source) => [source.id, { snapshotId: source.id, included: true }]),
        ).values(),
      ],
    },
    report,
    !!snapshot && (!selectedId || !!view),
    state.projectId,
  );
  const { text, provider, model, effort, mode, attachments, customModel } = composer.draft;
  const setText = (text: string) => composer.update({ text });
  const setProvider = (provider: ProviderId) => composer.update({ provider });
  const setModel = (model: string) => composer.update({ model });
  const setEffort = (effort: string) => composer.update({ effort });
  const setCustomModel = (customModel: boolean) => composer.update({ customModel });
  const setMode = (value: string | ((current: string) => string)) =>
    composer.update((current) => ({
      mode: typeof value === 'function' ? value(current.mode) : value,
    }));
  const setAttachments = (value: Attachment[] | ((current: Attachment[]) => Attachment[])) =>
    composer.update((current) => ({
      attachments: typeof value === 'function' ? value(current.attachments) : value,
    }));
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectKind, setNewProjectKind] = useState<'chat' | 'folder'>('chat');
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [knowledgeProjectId, setKnowledgeProjectId] = useState<string | null>(null);
  const [sourceDialog, setSourceDialog] = useState<'web' | 'memory' | 'prompts' | null>(null);
  const [contextToolsOpen, setContextToolsOpen] = useState(false);
  const [sourceDraftKey, setSourceDraftKey] = useState('');
  const [instructionUpdate, setInstructionUpdate] = useState<{
    key: string;
    signature: string;
    draft: Draft;
    refs: ContextRef[];
    excludedContextSnapshotIds: string[];
    previous: ContextSnapshot[];
    next: ContextSnapshot;
  } | null>(null);
  const [instructionUpdateBusy, setInstructionUpdateBusy] = useState(false);
  const [memoryInitialNote, setMemoryInitialNote] = useState<{
    text: string;
    source?: { conversationId: string; messageId: string };
  }>();
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [artifactSelection, setArtifactSelection] = useState<ArtifactReference>();
  const [artifactProposal, setArtifactProposal] = useState<{
    artifactId: string;
    baseRevisionId: string;
    source: string;
    sourceMessageId: string;
  }>();
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparisonInput, setComparisonInput] =
    useState<Omit<ComparisonInput, 'requestId' | 'targets' | 'pdfDelivery'>>();
  const [historicalContext, setHistoricalContext] = useState<{
    conversationId: string;
    sources: ContextSnapshotSummary[];
  } | null>(null);
  const [findInChat, setFindInChat] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<Attachment | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [filePreview, setFilePreview] = useState<{
    path: string;
    line?: number;
    content: string;
  } | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [reviewSource, setReviewSource] = useState<{
    text: string;
    projectId: string | null;
    workspaceId: string | null;
  } | null>(null);
  const [reviewProvider, setReviewProvider] = useState<ProviderId>('codex');
  const [fileSelectorOpen, setFileSelectorOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 600px)').matches);
  const [narrowSidebarOpen, setNarrowSidebarOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const [sending, setSending] = useState(false);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [handoffCaptures, setHandoffCaptures] = useState<
    { ref: ContextRef; source: ContextSnapshot }[]
  >([]);
  const [rename, setRename] = useState<string | null>(null);
  const [managedProject, setManagedProject] = useState<Project | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const timeline = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const selectedProvider = useRef(provider);
  const restoredFailures = useRef(new Set<string>());
  const currentDraftKey = useRef(draftKey);
  currentDraftKey.current = draftKey;
  const sendingRef = useRef(false);
  useEffect(() => {
    setSourceDialog(null);
    setKnowledgeProjectId(null);
    setTagsOpen(false);
    setContextOpen(false);
    setContextToolsOpen(false);
    setInstructionUpdate(null);
  }, [draftKey]);
  const latestUserMessageId = [...(view?.messages ?? [])]
    .reverse()
    .find((message) => message.role === 'user')?.id;
  useEffect(() => {
    if (!selectedId || !latestUserMessageId) return;
    let active = true;
    void window.desktop
      .conversationContextSources(selectedId)
      .then((sources) => {
        if (active) setHistoricalContext({ conversationId: selectedId, sources });
      })
      .catch((error) => {
        if (active) report(error);
      });
    return () => {
      active = false;
    };
  }, [selectedId, latestUserMessageId]);
  useEffect(() => {
    const media = matchMedia('(max-width: 600px)');
    const update = () => {
      setNarrow(media.matches);
      setNarrowSidebarOpen(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!narrow || !narrowSidebarOpen) return;
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      requestAnimationFrame(() => {
        if (!document.querySelector('dialog[open]')) sidebarToggle.current?.focus();
      });
    };
  }, [narrow, narrowSidebarOpen]);
  useEffect(() => {
    setNarrowSidebarOpen(false);
  }, [
    selectedId,
    state.projectId,
    state.settingsOpen,
    searchOpen,
    archiveOpen,
    commandsOpen,
    managedProject?.id,
  ]);
  selectedProvider.current = provider;
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = window.desktop.onEvent((event) => {
      if (event.type === 'runtime-error') report(event.message);
      if (event.type === 'file-open') setFilePreview(event);
      if (event.type === 'runtime-state') {
        set({ runtimeStatus: event.status });
        if (event.status === 'ready') void refresh();
      }
      if (event.type === 'changed' || event.type === 'conversation') {
        timer ??= setTimeout(() => {
          timer = undefined;
          void refresh();
        }, 75);
      }
    });
    void window.desktop.probe().catch(report);
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    nearBottom.current = true;
  }, [selectedId]);
  useEffect(() => {
    if (state.anchorMessageId) {
      timeline.current
        ?.querySelector(`#message-${CSS.escape(state.anchorMessageId)}`)
        ?.scrollIntoView({ block: 'center' });
      nearBottom.current = false;
      setShowLatest(true);
    } else if (nearBottom.current && timeline.current)
      timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [view, state.anchorMessageId]);
  useEffect(() => {
    if (!snapshot) return;
    const a = snapshot.settings.appearance;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const theme = a.theme === 'system' ? (media.matches ? 'dark' : 'light') : a.theme;
      document.documentElement.dataset.theme = theme;
      void window.desktop.windowTheme(a.background ? 'media' : theme).catch(report);
    };
    update();
    document.documentElement.style.setProperty('--surface-opacity', String(a.surfaceOpacity));
    document.documentElement.style.setProperty(
      '--font-size',
      `${snapshot.settings.fontSize ?? 16}px`,
    );
    document.documentElement.dataset.density = snapshot.settings.density ?? 'comfortable';
    document.documentElement.dataset.reducedMotion = String(a.reducedMotion);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [snapshot?.settings.appearance, snapshot?.settings.fontSize, snapshot?.settings.density]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (document.querySelector('dialog[open]')) return;
      if (
        event.ctrlKey &&
        (event.target as HTMLElement)?.closest?.('.terminalPanel') &&
        !event.shiftKey
      )
        return;
      if (event.key === 'n') {
        event.preventDefault();
        void newChat();
      }
      if (event.key === ',') {
        event.preventDefault();
        set({ settingsOpen: true });
      }
      if (event.key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        setFindInChat(false);
      }
      if (event.key === 'f' && useApp.getState().selectedId) {
        event.preventDefault();
        setSearchOpen(true);
        setFindInChat(true);
      }
      if (event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setCommandsOpen(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [state.projectId]);
  useEffect(() => {
    setModels(modelCatalog(provider));
  }, [provider]);
  async function newChat(withoutMemory = false) {
    try {
      setNarrowSidebarOpen(false);
      if (selectedId) {
        const key = `new:${view?.conversation.workspaceId ?? state.workspaceId ?? state.projectId ?? 'personal'}`;
        const saved = composer.peek(key) ?? (await window.desktop.draft(key));
        if (
          !saved?.text.trim() &&
          !saved?.attachments.length &&
          !saved?.contextRefs?.length &&
          !saved?.artifactReferences?.length
        ) {
          const defaults = state.projectId
            ? await window.desktop.projectDefaults(state.projectId)
            : {};
          await composer.replace(key, {
            text: '',
            provider,
            model,
            effort,
            mode: isBypassMode(mode) ? 'code' : mode,
            ...defaults,
            attachments: [],
            contextRefs: withoutMemory
              ? state.projectId
                ? await window.desktop.projectContextDefaults(state.projectId)
                : []
              : await newDraftContext(state.projectId),
          });
        }
      } else if (isBypassMode(mode)) setMode('code');
      if (withoutMemory) {
        const c = await window.desktop.createConversation(state.projectId, state.workspaceId);
        await composer.replace(c.id, {
          text: '',
          attachments: [],
          provider,
          model,
          effort,
          mode: isBypassMode(mode) ? 'code' : mode,
          contextRefs: state.projectId
            ? await window.desktop.projectContextDefaults(state.projectId)
            : [],
          excludedContextSnapshotIds: [],
        });
        await select(c.id);
        await refresh();
      } else await select(null);
      textarea.current?.focus();
    } catch (error) {
      report(error);
    }
  }
  async function addProject() {
    setCreatingProject(true);
    try {
      const p =
        newProjectKind === 'chat'
          ? await window.desktop.createChatProject(newProjectName)
          : await window.desktop.addProject();
      if (p) {
        set({
          projectId: p.id,
          workspaceId: p.workspaceId ?? undefined,
          panel: null,
          terminal: false,
        });
        setNewProjectOpen(false);
        setNewProjectName('');
        await select(null);
        await refresh();
      }
    } catch (e) {
      report(e);
    } finally {
      setCreatingProject(false);
    }
  }
  const project = snapshot?.projects.find(
    (p) => p.id === (view?.conversation.projectId ?? state.projectId),
  );
  const workspace = snapshot?.workspaces?.find(
    (w) => w.id === (view?.conversation.workspaceId ?? state.workspaceId ?? project?.workspaceId),
  );
  const workspaceProject =
    project && workspace
      ? {
          ...project,
          id: workspace.id,
          path: workspace.path,
          trusted: workspace.trusted,
          workspaceId: workspace.id,
        }
      : project?.kind === 'folder'
        ? project
        : undefined;
  const connection = snapshot?.connections.find((c) => c.id === provider);
  const providerEnabled = isProviderAvailable(provider) && !!connection?.enabled;
  const availability = snapshot?.availability.find((a) => a.id === provider);
  const availableModes =
    availability?.capabilities.modes ??
    capabilities(provider).modes.filter((m) => m.workspaceAccess !== 'write');
  const attachmentProblem = attachments.find(
    (a) =>
      (a.kind === 'image' &&
        !supportsNativeAttachment(provider, model || connection?.model || '', a.kind)) ||
      (a.kind === 'pdf' &&
        a.delivery !== 'text' &&
        !a.content.trim() &&
        !supportsNativeAttachment(provider, model || connection?.model || '', a.kind)),
  );
  const canSubmit =
    providerEnabled &&
    !view?.conversation.archived &&
    composer.ready &&
    !state.loading &&
    !preparing &&
    !attachmentProblem &&
    state.runtimeStatus === 'ready' &&
    (!availability || !['not-installed', 'sign-in', 'error'].includes(availability.status)) &&
    (connection?.kind !== 'cli-agent' ||
      ((!workspace || (workspace.trusted && !workspace.archived)) &&
        (mode === 'ask' || !!workspaceProject))) &&
    availableModes.some((m) => m.id === mode);
  const modelReady =
    connection?.kind !== 'api-chat' || provider === 'demo' || !!(model || connection.model);
  const active = snapshot?.activeTurns.find((t) => t.conversationId === selectedId);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active?.id]);
  useEffect(() => {
    if (!composer.ready || !view || text.trim()) return;
    const last = view.messages.at(-1);
    if (last?.errorInfo?.code === 'context-limit' && !restoredFailures.current.has(last.id)) {
      restoredFailures.current.add(last.id);
      const user = [...view.messages].reverse().find((m) => m.role === 'user');
      if (user) composer.update({ text: user.text, attachments: user.attachments ?? [] });
    }
  }, [view, composer.ready]);
  const visibleConversations =
    snapshot?.conversations.filter(
      (c) =>
        (!state.projectId || c.projectId === state.projectId) &&
        (!tagFilter || c.tags?.some((tag) => tag.id === tagFilter)) &&
        c.title.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const collapsed = narrow ? !narrowSidebarOpen : (snapshot?.settings.sidebarCollapsed ?? false);
  async function send(transfer?: string) {
    if (!text.trim() || sendingRef.current || sending || active || !canSubmit || !modelReady)
      return;
    if (
      view &&
      view.messages.length &&
      (view.conversation.providerId !== provider ||
        view.conversation.model !== (model || connection?.model || '') ||
        view.conversation.mode !== mode ||
        view.conversation.connectionChanged ||
        (connection?.kind === 'cli-agent' && !!view.conversation.parentConversationId)) &&
      transfer === undefined
    ) {
      sendingRef.current = true;
      const key = draftKey;
      try {
        const history = await window.desktop.transcript(view.conversation.id);
        const pending = composer.draft.contextRefs?.length
          ? await window.desktop.contextSnapshots(
              composer.draft.contextRefs.map((ref) => ref.snapshotId),
            )
          : [];
        if (currentDraftKey.current !== key) return;
        const selectedHistory = composer.draft.historyMessageIds
          ? history.filter((message) => composer.draft.historyMessageIds!.includes(message.id))
          : history;
        const sources = [
          ...new Map(
            [
              ...selectedHistory.flatMap((message) =>
                (message.contextSources ?? []).filter((source) => source.kind !== 'instructions'),
              ),
              ...pending,
            ].map((source) => [source.id, source]),
          ).values(),
        ];
        setHandoffCaptures(
          sources.map((source) => ({
            source,
            ref: {
              ...composer.draft.contextRefs?.find((ref) => ref.snapshotId === source.id),
              snapshotId: source.id,
              included:
                composer.draft.contextRefs?.find((ref) => ref.snapshotId === source.id)
                  ?.included !== false &&
                !composer.draft.excludedContextSnapshotIds?.includes(source.id),
            },
          })),
        );
        setHandoff(
          selectedHistory
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map(
              (m) =>
                `${m.role === 'user' ? 'User' : m.providerId}: ${m.context ? m.context + '\n\n' : ''}${m.text}${(
                  m.attachments ?? []
                )
                  .filter((attachment) => attachment.kind !== 'image' && attachment.content)
                  .map(
                    (attachment) =>
                      `\n\nCaptured attachment: ${attachment.name ?? attachment.path}\n${attachment.content}`,
                  )
                  .join('')}`,
            )
            .join('\n\n'),
        );
      } catch (error) {
        report(error);
      } finally {
        sendingRef.current = false;
      }
      return;
    }
    setSending(true);
    sendingRef.current = true;
    const submission: Draft = { ...composer.draft, attachments: [...attachments] };
    const submittedKey = draftKey;
    try {
      let id = selectedId;
      if (!id) {
        const c = await window.desktop.createConversation(state.projectId, state.workspaceId);
        id = c.id;
        await composer.replace(id, submission);
        await select(id);
      }
      const input: SendInput = {
        conversationId: id,
        requestId: crypto.randomUUID(),
        text: submission.text,
        providerId: submission.provider,
        model: submission.model,
        mode: submission.mode,
        effort: submission.effort,
        attachments: submission.attachments,
        historyMessageIds: transfer === undefined ? submission.historyMessageIds : undefined,
        contextRefs: transfer
          ? handoffCaptures.filter((capture) => capture.ref.included).map((capture) => capture.ref)
          : submission.contextRefs,
        excludedContextSnapshotIds: transfer
          ? [
              ...new Set([
                ...(submission.excludedContextSnapshotIds ?? []).filter(
                  (id) =>
                    !handoffCaptures.some(
                      (capture) => capture.ref.snapshotId === id && capture.ref.included,
                    ),
                ),
                ...handoffCaptures
                  .filter((capture) => !capture.ref.included)
                  .map((capture) => capture.ref.snapshotId),
              ]),
            ]
          : submission.excludedContextSnapshotIds,
        artifactReferences: submission.artifactReferences,
        ...(transfer !== undefined ? { handoff: transfer } : {}),
      };
      const snapshots = input.contextRefs?.length
        ? await window.desktop.contextSnapshots(input.contextRefs.map((ref) => ref.snapshotId))
        : [];
      await window.desktop.send(input);
      const instructions = new Set(
        snapshots.filter((source) => source.kind === 'instructions').map((source) => source.id),
      );
      const consumed = {
        ...submission,
        text: '',
        attachments: [],
        artifactReferences: [],
        historyMessageIds: input.historyMessageIds,
        excludedContextSnapshotIds: input.excludedContextSnapshotIds,
        contextRefs: input.contextRefs?.filter((ref) => instructions.has(ref.snapshotId)),
      };
      await composer.replace(id, consumed);
      if (submittedKey !== id) await composer.discard(submittedKey);
      setHandoff(null);
      nearBottom.current = true;
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  const attach = (file: { path: string; content: string }) => {
    if (attachments.length >= 10 && !attachments.some((item) => item.path === file.path)) {
      report(new Error('Attach up to 10 files per message.'));
      return;
    }
    setAttachments((previous) => [...previous.filter((f) => f.path !== file.path), file]);
    textarea.current?.focus();
  };
  async function attachFiles() {
    const key = draftKey;
    setPreparing(true);
    try {
      const files = await window.desktop.attachFiles();
      if (currentDraftKey.current !== key) {
        report(
          new Error(
            'Conversation changed while choosing attachments. Choose the files again in the intended conversation.',
          ),
        );
        return;
      }
      const merged = [
        ...new Map([...attachments, ...files].map((file) => [file.path, file])).values(),
      ];
      if (merged.length > 10) throw new Error('Attach up to 10 files per message.');
      setAttachments(merged);
      textarea.current?.focus();
    } catch (error) {
      report(error);
    } finally {
      setPreparing(false);
    }
  }
  async function importFiles(files: File[]) {
    const key = draftKey;
    setPreparing(true);
    try {
      if (files.length + attachments.length > 10)
        throw new Error('Attach up to 10 files per message.');
      const imported: Attachment[] = [];
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) throw new Error('Attachments may be up to 10 MB each.');
        imported.push(
          await window.desktop.attachBytes({
            name: file.name || 'screenshot.png',
            mime: file.type,
            bytes: [...new Uint8Array(await file.arrayBuffer())],
          }),
        );
      }
      if (currentDraftKey.current !== key)
        throw new Error(
          'Conversation changed while preparing attachments. Attach them again in the intended conversation.',
        );
      setAttachments((current) => [...current, ...imported]);
    } catch (error) {
      report(error);
    } finally {
      setPreparing(false);
    }
  }
  async function branch(messageId: string, edit = false) {
    if (!selectedId) return;
    try {
      const c = await window.desktop.branchConversation(selectedId, messageId, edit);
      await select(c.id);
      await refresh();
    } catch (error) {
      report(error);
    }
  }
  async function retry() {
    const message = [...(view?.messages ?? [])].reverse().find((m) => m.role === 'user');
    if (message) composer.update({ text: message.text, attachments: message.attachments ?? [] });
  }
  async function secondOpinion(messageId: string) {
    const message = view?.messages.find((m) => m.id === messageId);
    if (!message || !view) return;
    setReviewProvider(
      snapshot?.connections.find((c) => c.enabled && c.id !== provider && c.id !== 'demo')?.id ??
        provider,
    );
    setReviewSource({
      text: message.text,
      projectId: view.conversation.projectId,
      workspaceId: view.conversation.workspaceId,
    });
  }
  async function prepareReview() {
    if (!reviewSource) return;
    const target = snapshot?.connections.find((c) => c.id === reviewProvider);
    if (!target) return;
    try {
      const c = await window.desktop.createConversation(
        reviewSource.projectId ?? undefined,
        reviewSource.workspaceId ?? undefined,
      );
      await composer.replace(c.id, {
        text: `Review this response for correctness and omissions. Give an independent assessment without changing files.\n\n${reviewSource.text}`,
        attachments: [],
        provider: reviewProvider,
        model: target.model,
        mode: target.kind === 'cli-agent' ? 'ask' : 'chat',
        effort: '',
      });
      setReviewSource(null);
      await select(c.id);
      await refresh();
    } catch (error) {
      report(error);
    }
  }
  async function updateProjectDefaultDrafts(project: Project, defaults: Partial<Draft>) {
    const keys = new Set([
      `new:${project.id}`,
      ...(snapshot?.workspaces ?? [])
        .filter((w) => w.projectId === project.id)
        .map((w) => `new:${w.id}`),
    ]);
    for (const key of keys) {
      const stored = composer.peek(key) ?? (await window.desktop.draft(key));
      if (stored && !stored.text.trim() && !stored.attachments.length)
        await composer.replace(key, { ...stored, ...defaults, attachments: [] });
    }
  }
  function openSources(kind: 'web' | 'memory' | 'prompts') {
    setSourceDraftKey(draftKey);
    setMemoryInitialNote(undefined);
    setSourceDialog(kind);
  }
  async function includeSources(refs: ContextRef[], expectedKey = sourceDraftKey) {
    if (currentDraftKey.current !== expectedKey || !composer.ready || state.loading)
      throw new Error(
        'The conversation changed or is still loading. Add sources again in the intended conversation.',
      );
    const current = structuredClone(composer.peek(expectedKey) ?? composer.draft);
    const signature = JSON.stringify(current);
    const historicalInstructions = [
      ...new Map(
        (historicalContext?.conversationId === selectedId ? historicalContext.sources : [])
          .filter((source) => source.kind === 'instructions')
          .map((source) => [source.itemId ?? source.id, source]),
      ).values(),
    ];
    const [currentSources, incomingSources, capturedInstructions] = await Promise.all([
      window.desktop.contextSnapshots((current.contextRefs ?? []).map((ref) => ref.snapshotId)),
      window.desktop.contextSnapshots(refs.map((ref) => ref.snapshotId)),
      window.desktop.contextSnapshots(historicalInstructions.map((source) => source.id)),
    ]);
    if (
      currentDraftKey.current !== expectedKey ||
      !composer.isReady() ||
      useApp.getState().loading ||
      JSON.stringify(composer.peek(expectedKey)) !== signature
    )
      throw new Error(
        'The draft changed while sources were being prepared. Add them again to the current draft.',
      );
    const plan = planContextInclusion(
      current.contextRefs ?? [],
      [
        ...new Map(
          [...capturedInstructions, ...currentSources].map((source) => [source.id, source]),
        ).values(),
      ],
      refs,
      incomingSources,
      current.excludedContextSnapshotIds,
    );
    if (plan.instructionChanged && selectedId && view?.messages.length) {
      setKnowledgeProjectId(null);
      setSourceDialog(null);
      setInstructionUpdate({
        key: expectedKey,
        signature,
        draft: current,
        refs: plan.refs,
        excludedContextSnapshotIds: plan.excludedContextSnapshotIds,
        previous: plan.previousInstructions,
        next: plan.nextInstruction!,
      });
      return;
    }
    composer.update({
      contextRefs: plan.refs,
      excludedContextSnapshotIds: plan.excludedContextSnapshotIds,
    });
  }
  async function forkWithUpdatedInstructions() {
    const update = instructionUpdate;
    if (!update || instructionUpdateBusy) return;
    const unchanged = () =>
      currentDraftKey.current === update.key &&
      composer.isReady() &&
      !useApp.getState().loading &&
      JSON.stringify(composer.peek(update.key)) === update.signature;
    setInstructionUpdateBusy(true);
    try {
      if (!unchanged())
        throw new Error(
          'The original draft changed. Select the updated instructions again before creating a fork.',
        );
      await composer.replace(update.key, update.draft);
      const [snapshot, history] = await Promise.all([
        window.desktop.snapshot(),
        window.desktop.transcript(update.key),
      ]);
      if (!unchanged()) throw new Error('The conversation or draft changed. No fork was created.');
      if (snapshot.activeTurns.some((turn) => turn.conversationId === update.key))
        throw new Error(
          'Wait for this response to finish or stop it before changing instructions.',
        );
      const last = history.at(-1);
      if (!last)
        throw new Error(
          'This conversation has no saved messages. Refresh it before updating instructions.',
        );
      const conversation = await window.desktop.branchConversation(update.key, last.id, false);
      const branchedDraft = await window.desktop.draft(conversation.id);
      if (!unchanged())
        throw new Error(
          'A fork was saved, but the original draft changed. Both are preserved; select the fork from history to continue.',
        );
      await composer.replace(conversation.id, {
        ...update.draft,
        mode: isBypassMode(update.draft.mode) ? 'code' : update.draft.mode,
        contextRefs: update.refs.map((ref) =>
          ref.snapshotId === update.next.id ? { ...ref, reviewed: true } : ref,
        ),
        historyMessageIds: branchedDraft?.historyMessageIds,
        excludedContextSnapshotIds: update.excludedContextSnapshotIds,
      });
      if (!unchanged())
        throw new Error(
          'The updated fork is saved. The current conversation changed; select the fork from history to continue.',
        );
      setInstructionUpdate(null);
      await select(conversation.id);
      await refresh();
      textarea.current?.focus();
    } catch (error) {
      report(error);
    } finally {
      setInstructionUpdateBusy(false);
    }
  }
  function prepareArtifactRevision(
    ref: ArtifactReference & { title: string; kind: ArtifactKind; source: string },
  ) {
    const current = composer.peek(currentDraftKey.current) ?? composer.draft;
    if (!composer.ready || state.loading) {
      report(
        new Error('Load the current draft and context before preparing an artifact revision.'),
      );
      return;
    }
    if (current.text.trim()) {
      report(new Error('Save or clear the current prompt before preparing an artifact revision.'));
      return;
    }
    composer.update({
      text: `Revise the attached ${ref.kind} artifact "${ref.title}". Describe the changes you want here. Return the complete replacement source in one fenced block.`,
      artifactReferences: [{ artifactId: ref.artifactId, revisionId: ref.revisionId }],
    });
    setArtifactsOpen(false);
    textarea.current?.focus();
  }
  function openComparison(fromDraft = true) {
    setComparisonInput(
      fromDraft
        ? {
            sourceConversationId: selectedId ?? undefined,
            projectId: project?.id,
            workspaceId: workspace?.id,
            text: composer.draft.text,
            attachments: composer.draft.attachments,
            historyMessageIds: composer.draft.historyMessageIds,
            contextRefs: composer.draft.contextRefs,
            excludedContextSnapshotIds: composer.draft.excludedContextSnapshotIds,
            artifactReferences: composer.draft.artifactReferences,
          }
        : undefined,
    );
    setComparisonOpen(true);
  }
  if (!snapshot)
    return (
      <div className={styles.loading}>
        <div className="brandMark">
          m<span>✳</span>
        </div>
        <p>{state.error || 'Opening your workspace…'}</p>
      </div>
    );
  return (
    <div
      className={styles.app}
      data-background={!!snapshot.settings.appearance.background}
      data-platform={window.desktop.platform}
      data-sidebar-collapsed={collapsed}
      data-narrow={narrow}
    >
      <Background appearance={snapshot.settings.appearance} />
      {!collapsed && (
        <aside
          ref={sidebar}
          className={styles.sidebar}
          onKeyDown={(event) => {
            if (!narrow) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              setNarrowSidebarOpen(false);
            }
            if (event.key === 'Tab') {
              const controls = Array.from(
                sidebar.current?.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input, [tabindex="0"]',
                ) ?? [],
              );
              const first = controls[0],
                last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <div className={styles.brand}>
            <span className="brandMark">
              m<span>✳</span>
            </span>
            <strong>multiclient</strong>
            <button
              className="iconButton"
              aria-label="Collapse sidebar"
              onClick={() =>
                narrow
                  ? setNarrowSidebarOpen(false)
                  : void window.desktop.settingsPatch({ sidebarCollapsed: true }).catch(report)
              }
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
          <button className={styles.newChat} onClick={() => void newChat()}>
            <Plus size={18} /> New conversation{' '}
            <kbd>{window.desktop.platform === 'darwin' ? '⌘ N' : 'Ctrl N'}</kbd>
          </button>
          <button className={styles.navButton} onClick={() => setSearchOpen(!searchOpen)}>
            <Search size={17} /> Search conversations
          </button>
          <button className={styles.navButton} onClick={() => setArchiveOpen(true)}>
            Archive & backups
          </button>
          <button
            className={styles.navButton}
            onClick={() => {
              setArtifactSelection(undefined);
              setArtifactProposal(undefined);
              setSourceDraftKey(draftKey);
              setArtifactsOpen(true);
            }}
          >
            Artifacts
          </button>
          <button className={styles.navButton} onClick={() => openComparison(false)}>
            Model comparisons
          </button>
          <button
            className={`${styles.navButton} ${!state.projectId ? styles.selected : ''}`}
            aria-pressed={!state.projectId}
            onClick={() => {
              set({ projectId: undefined, workspaceId: undefined });
              void select(null);
            }}
          >
            <MessageSquare size={16} /> All conversations
          </button>
          <div className={styles.sectionTitle}>
            <span>Projects</span>
            <button
              className="iconButton"
              aria-label="Add project"
              onClick={() => setNewProjectOpen(true)}
            >
              <Plus size={15} />
            </button>
          </div>
          <div className={styles.projects}>
            {snapshot.projects.map((p) => (
              <div className={styles.projectRow} key={p.id}>
                <button
                  className={`${styles.navButton} ${state.projectId === p.id ? styles.selected : ''}`}
                  aria-pressed={state.projectId === p.id}
                  title={p.path ?? 'Chat project'}
                  onClick={() => {
                    set({
                      projectId: p.id,
                      workspaceId: p.workspaceId ?? undefined,
                      panel: null,
                      terminal: false,
                    });
                    void select(null);
                  }}
                >
                  {p.kind === 'chat' ? <MessageSquare size={16} /> : <Folder size={16} />}
                  <span>{p.name}</span>
                </button>
                <button
                  className={`iconButton ${styles.projectActions}`}
                  aria-label={`Manage ${p.name}`}
                  onClick={() => setManagedProject(p)}
                >
                  <MoreHorizontal size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className={styles.sectionTitle}>
            <span>{state.projectId ? 'Project chats' : 'Recent chats'}</span>
          </div>
          <label className={styles.tagFilter}>
            Filter by tag
            <select
              aria-label="Filter chats by tag"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
            >
              <option value="">All tags</option>
              {[
                ...new Map(
                  snapshot.conversations.flatMap((c) => c.tags ?? []).map((tag) => [tag.id, tag]),
                ).values(),
              ]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
            </select>
          </label>
          <div className={styles.recents}>
            {visibleConversations.map((c) => (
              <button
                key={c.id}
                title={c.title}
                aria-label={c.title}
                aria-current={selectedId === c.id ? 'page' : undefined}
                className={`${styles.conversation} ${selectedId === c.id ? styles.selected : ''}`}
                onClick={() => void select(c.id)}
              >
                <span>
                  {c.pinned ? '★ ' : ''}
                  {c.title}
                  <small aria-hidden="true">
                    {snapshot.activeTurns.find((t) => t.conversationId === c.id)?.status ??
                      c.lastStatus ??
                      ''}
                  </small>
                </span>
                {snapshot.activeTurns.some((t) => t.conversationId === c.id) && (
                  <i className="workingDot" />
                )}
              </button>
            ))}
          </div>
          <div className={styles.sidebarFooter}>
            <button className={styles.navButton} onClick={() => setCommandsOpen(true)}>
              Commands <kbd>Ctrl Shift P</kbd>
            </button>
            <button className={styles.navButton} onClick={() => set({ settingsOpen: true })}>
              <SettingsIcon size={17} /> Settings & connections
            </button>
          </div>
        </aside>
      )}
      {narrow && narrowSidebarOpen && (
        <button
          className="navigationBackdrop"
          aria-label="Close navigation"
          onClick={() => setNarrowSidebarOpen(false)}
        />
      )}
      <main className={styles.main} inert={narrow && narrowSidebarOpen}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            {collapsed && (
              <button
                className="iconButton"
                ref={sidebarToggle}
                aria-label="Expand sidebar"
                onClick={() =>
                  narrow
                    ? setNarrowSidebarOpen(true)
                    : void window.desktop.settingsPatch({ sidebarCollapsed: false }).catch(report)
                }
              >
                <PanelLeftOpen size={18} />
              </button>
            )}
            <Picker
              label="Current project"
              value={project?.id ?? ''}
              disabled={!!selectedId}
              options={[
                { value: '', label: 'Personal space', icon: <Folder size={15} /> },
                ...snapshot.projects.map((p) => ({
                  value: p.id,
                  label: p.name,
                  icon: <Folder size={15} />,
                })),
              ]}
              onChange={(value) => set({ projectId: value || undefined, workspaceId: undefined })}
            />
            <span className={styles.breadcrumbSlash}>/</span>
            <span>{view?.conversation.title ?? 'New conversation'}</span>
            {project?.kind === 'folder' && (
              <Picker
                label="Workspace"
                value={workspace?.id ?? project.workspaceId ?? ''}
                disabled={!!selectedId}
                options={(snapshot.workspaces ?? [])
                  .filter((w) => w.projectId === project.id && !w.archived)
                  .map((w) => ({
                    value: w.id,
                    label: w.kind === 'primary' ? 'Primary checkout' : w.branch,
                  }))}
                onChange={(workspaceId) => set({ workspaceId })}
              />
            )}
          </div>
          <div className={`row compact ${styles.headerActions}`}>
            {project?.kind === 'folder' && (
              <details className={styles.toolMenu}>
                <summary aria-label="Workspace tools" title="Workspace tools">
                  <SlidersHorizontal size={17} />
                </summary>
                <div className={styles.menuPanel}>
                  <button
                    aria-label="Toggle files"
                    onClick={(event) => {
                      set({ panel: state.panel === 'files' ? null : 'files' });
                      event.currentTarget.closest('details')!.open = false;
                    }}
                  >
                    <FileText size={16} /> Files
                  </button>
                  <button
                    aria-label="Toggle Git changes"
                    onClick={(event) => {
                      set({ panel: state.panel === 'git' ? null : 'git' });
                      event.currentTarget.closest('details')!.open = false;
                    }}
                  >
                    <GitBranch size={16} /> Changes
                  </button>
                  <button
                    aria-label="Toggle terminal"
                    onClick={(event) => {
                      set({ terminal: !state.terminal });
                      event.currentTarget.closest('details')!.open = false;
                    }}
                  >
                    <TerminalSquare size={16} /> Terminal
                  </button>
                </div>
              </details>
            )}
            {selectedId && (
              <button
                className="iconButton"
                aria-label="Conversation options"
                onClick={() => setRename(view?.conversation.title ?? '')}
              >
                <MoreHorizontal size={19} />
              </button>
            )}
          </div>
        </header>
        {state.error && (
          <div className="errorBanner" role="alert">
            <span>{state.error}</span>
            <button
              className="iconButton"
              aria-label="Dismiss error"
              onClick={() => set({ error: '' })}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {state.runtimeStatus !== 'ready' && (
          <div className="errorBanner" role="status">
            <span>
              {state.runtimeStatus === 'recovering'
                ? 'Recovering saved work…'
                : 'The local runtime stopped. Your saved work is preserved.'}
            </span>
            {state.runtimeStatus === 'failed' && (
              <button
                className="button"
                onClick={() => void window.desktop.restartRuntime().catch(report)}
              >
                Restart runtime
              </button>
            )}
          </div>
        )}
        <div className={styles.workspace}>
          <div className={`${styles.center} ${!view?.messages.length ? styles.emptyState : ''}`}>
            <div
              ref={timeline}
              className={styles.timeline}
              onScroll={() => {
                if (timeline.current)
                  nearBottom.current =
                    timeline.current.scrollHeight -
                      timeline.current.scrollTop -
                      timeline.current.clientHeight <
                    100;
                setShowLatest(!nearBottom.current);
              }}
            >
              {!view?.messages.length ? (
                <section className={styles.welcome}>
                  <span className={styles.welcomeMark} aria-hidden="true">
                    ✳
                  </span>
                  <h1>What’s next?</h1>
                </section>
              ) : (
                <div className={styles.messages}>
                  {view.hasMore && (
                    <button
                      className="textButton olderButton"
                      disabled={state.paging}
                      onClick={async () => {
                        const container = timeline.current;
                        const height = container?.scrollHeight ?? 0;
                        const top = container?.scrollTop ?? 0;
                        nearBottom.current = false;
                        await state.loadEarlier();
                        requestAnimationFrame(() => {
                          if (container && currentDraftKey.current === draftKey)
                            container.scrollTop = top + container.scrollHeight - height;
                        });
                      }}
                    >
                      Load earlier messages
                    </button>
                  )}
                  {view.messages.map((message) => {
                    const answerText = message.blocks?.some((block) => block.phase === 'answer')
                      ? message.blocks
                          .filter((block) => block.phase === 'answer')
                          .map((block) => block.text)
                          .join('\n\n')
                      : message.text;
                    const revisionTargets =
                      message.role === 'assistant' && message.status === 'completed'
                        ? (view.messages.find(
                            (item) => item.role === 'user' && item.turnId === message.turnId,
                          )?.artifactReferences ?? [])
                        : [];
                    const activities =
                      message.role === 'assistant'
                        ? view.tools.filter((tool) => tool.turnId === message.turnId)
                        : [];
                    return (
                      <article
                        key={message.id}
                        id={`message-${message.id}`}
                        data-message-role={message.role}
                        className={`${styles.message} ${message.role === 'user' ? styles.userMessage : ''}`}
                      >
                        <div className={styles.messageLabel}>
                          {message.role === 'user' ? (
                            'You'
                          ) : (
                            <>
                              <ProviderIcon provider={message.providerId} tiny />
                              {snapshot.connections.find((c) => c.id === message.providerId)
                                ?.name ?? message.providerId}
                            </>
                          )}
                          <button
                            className="iconButton copyButton"
                            aria-label="Copy message"
                            onClick={() => window.desktop.copyText(message.text).catch(report)}
                          >
                            <Copy size={13} />
                          </button>
                          <time className="muted small" dateTime={message.createdAt}>
                            {new Date(message.createdAt).toLocaleTimeString(undefined, {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </time>
                          {!active &&
                            (message.role === 'user' || message.status === 'completed') && (
                              <button
                                className="textButton"
                                onClick={() => void branch(message.id, message.role === 'user')}
                              >
                                {message.role === 'user' ? 'Edit & resend' : 'Continue from here'}
                              </button>
                            )}
                          {!active &&
                            message.role === 'assistant' &&
                            message.status === 'completed' && (
                              <>
                                <button
                                  className="textButton"
                                  onClick={() => void secondOpinion(message.id)}
                                >
                                  Second opinion
                                </button>
                                <button
                                  className="textButton"
                                  onClick={() => {
                                    setSourceDraftKey(draftKey);
                                    setMemoryInitialNote({
                                      text: answerText,
                                      source: {
                                        conversationId: message.conversationId,
                                        messageId: message.id,
                                      },
                                    });
                                    setSourceDialog('memory');
                                  }}
                                >
                                  Save as memory
                                </button>
                                <SaveArtifactButton
                                  source={answerText}
                                  label="Save answer as document"
                                  kind="markdown"
                                  conversationId={message.conversationId}
                                  messageId={message.id}
                                  projectId={project?.id}
                                  onSaved={(result) => {
                                    setArtifactSelection({
                                      artifactId: result.artifact.id,
                                      revisionId: result.artifact.headRevisionId,
                                    });
                                    setArtifactProposal(undefined);
                                    setSourceDraftKey(draftKey);
                                    setArtifactsOpen(true);
                                  }}
                                />
                                {revisionTargets.map((ref) => (
                                  <button
                                    key={ref.revisionId}
                                    className="textButton"
                                    onClick={() => {
                                      const fenced = answerText.match(/```[^\n]*\n([\s\S]*?)\n```/);
                                      setArtifactSelection(ref);
                                      setArtifactProposal({
                                        artifactId: ref.artifactId,
                                        baseRevisionId: ref.revisionId,
                                        source: fenced?.[1] ?? answerText,
                                        sourceMessageId: message.id,
                                      });
                                      setSourceDraftKey(draftKey);
                                      setArtifactsOpen(true);
                                    }}
                                  >
                                    Review proposed revision
                                  </button>
                                ))}
                              </>
                            )}
                        </div>
                        <MessageContent message={message} projectId={project?.id} />
                        {!!message.contextSources?.length && (
                          <SourceSnapshots sources={message.contextSources} />
                        )}
                        {!!message.artifactReferences?.length && (
                          <div className={styles.contextAssets}>
                            {message.artifactReferences.map((ref) => (
                              <button
                                key={ref.revisionId}
                                className="textButton"
                                onClick={() => {
                                  setArtifactSelection(ref);
                                  setArtifactProposal(undefined);
                                  setSourceDraftKey(draftKey);
                                  setArtifactsOpen(true);
                                }}
                              >
                                Captured artifact revision {ref.revisionId.slice(0, 8)}
                              </button>
                            ))}
                          </div>
                        )}
                        {message.attachments?.map((a, index) => (
                          <button
                            key={a.assetId ?? index}
                            className="attachmentChip"
                            onClick={() => setAttachmentPreview(a)}
                          >
                            {a.kind === 'image' && a.assetId && (
                              <img src={`media://assets/${a.assetId}`} alt="" />
                            )}
                            {a.name ?? a.path}
                          </button>
                        ))}
                        {message.context && (
                          <details className="toolActivity">
                            <summary>Shared context</summary>
                            <pre>{message.context}</pre>
                          </details>
                        )}
                        {!message.text && message.status === 'streaming' && (
                          <span className="thinking">
                            Working<span>···</span>
                          </span>
                        )}
                        {['cancelled', 'interrupted', 'failed'].includes(message.status) && (
                          <div className="messageStatus">
                            <strong>{message.status}</strong>
                            {message.errorInfo && (
                              <p>
                                {message.errorInfo.message}
                                {message.errorInfo.action && (
                                  <small>{message.errorInfo.action}</small>
                                )}
                              </p>
                            )}
                            <button
                              className="button"
                              disabled={!!active}
                              onClick={() => void retry()}
                            >
                              Review prompt to resend
                            </button>
                          </div>
                        )}
                        {activities.length > 0 && (
                          <details className="toolActivity">
                            <summary>
                              {activities.length}{' '}
                              {activities.length === 1 ? 'activity' : 'activities'}{' '}
                              <ChevronDown size={13} />
                            </summary>
                            {activities.map((tool) => (
                              <div key={tool.id} className={`tool ${tool.status}`}>
                                <strong>
                                  {tool.status === 'completed' ? (
                                    <Check size={13} />
                                  ) : (
                                    <span className="statusDot" />
                                  )}
                                  {tool.title}
                                </strong>
                                {tool.detail && <pre>{tool.detail}</pre>}
                              </div>
                            ))}
                          </details>
                        )}
                        {message.role === 'assistant' &&
                          view.interactions
                            .filter((interaction) => interaction.turnId === message.turnId)
                            .map((interaction) => (
                              <InteractionCard key={interaction.id} interaction={interaction} />
                            ))}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
            {showLatest && (
              <button
                className="button jumpLatest"
                onClick={() => {
                  nearBottom.current = true;
                  setShowLatest(false);
                  if (selectedId) void select(selectedId);
                }}
              >
                Jump to latest
              </button>
            )}
            <div className={styles.composerArea}>
              {(!providerEnabled || (availability && availability.status !== 'ready')) && (
                <div className="setupNotice">
                  <strong>Connect your AI tool</strong>
                  <p>
                    {!providerEnabled
                      ? 'Choose an enabled connection.'
                      : (availability?.detail ??
                        'Choose an official CLI subscription, API key, or local server.')}
                  </p>
                  <button className="button" onClick={() => set({ settingsOpen: true })}>
                    Set up a connection
                  </button>
                </div>
              )}
              {view?.conversation.archived && (
                <div className="setupNotice">
                  <p>This conversation is archived.</p>
                  <button
                    className="button"
                    onClick={() =>
                      void window.desktop
                        .restoreConversation(view.conversation.id)
                        .then(refresh)
                        .catch(report)
                    }
                  >
                    Restore conversation
                  </button>
                </div>
              )}
              {attachmentProblem && (
                <p role="status">
                  {attachmentProblem.name ?? attachmentProblem.path} needs a supported
                  image/document model. Select one or use extracted PDF text.
                </p>
              )}
              {!modelReady && (
                <p role="status">Choose a model or enter a model ID before sending.</p>
              )}
              {composer.loadError && (
                <div className="setupNotice" role="alert">
                  <p>
                    Draft and context could not be loaded: {composer.loadError}. Sending is paused
                    so configured sources are not omitted.
                  </p>
                  <button
                    className="button"
                    onClick={() => {
                      set({ error: '' });
                      composer.retry();
                    }}
                  >
                    Retry draft and context
                  </button>
                </div>
              )}
              {connection?.kind === 'cli-agent' && mode !== 'ask' && !workspaceProject && (
                <p role="status">Choose a trusted project to use this mode.</p>
              )}
              {project?.kind === 'folder' && !project.trusted && (
                <div className={styles.trustNotice}>
                  <ShieldCheck size={17} />
                  <span>
                    Trust <strong>{project.name}</strong> to let your CLI work here.
                    <small>Its instructions and files may influence your agent.</small>
                  </span>
                  <button
                    className="button"
                    onClick={() => window.desktop.trustProject(project.id, true).catch(report)}
                  >
                    Trust project
                  </button>
                </div>
              )}
              {!!(
                composer.draft.contextRefs?.length ||
                (historicalContext?.conversationId === selectedId &&
                  historicalContext.sources.length)
              ) && (
                <ContextManifest
                  key={`${draftKey}:${knowledgeProjectId ?? 'closed'}:${sourceDialog ?? 'closed'}`}
                  refs={composer.draft.contextRefs ?? []}
                  excludedIds={composer.draft.excludedContextSnapshotIds ?? []}
                  historicalSources={
                    historicalContext?.conversationId === selectedId
                      ? historicalContext.sources.filter(
                          (source) =>
                            source.kind === 'instructions' ||
                            (composer.draft.historyMessageIds
                              ? source.messageIds.some((id) =>
                                  composer.draft.historyMessageIds!.includes(id),
                                )
                              : !view?.currentSessionId ||
                                source.sessionIds.includes(view.currentSessionId)),
                        )
                      : []
                  }
                  onChange={(contextRefs, excludedContextSnapshotIds) =>
                    composer.update({ contextRefs, excludedContextSnapshotIds })
                  }
                />
              )}
              {!!composer.draft.artifactReferences?.length && (
                <div className={styles.contextAssets}>
                  {composer.draft.artifactReferences.map((ref) => (
                    <span key={ref.revisionId}>
                      <button
                        type="button"
                        className="textButton"
                        onClick={() => {
                          setArtifactSelection(ref);
                          setArtifactProposal(undefined);
                          setSourceDraftKey(draftKey);
                          setArtifactsOpen(true);
                        }}
                      >
                        Artifact revision {ref.revisionId.slice(0, 8)}
                      </button>
                      <button
                        type="button"
                        className="iconButton"
                        aria-label="Remove artifact context"
                        onClick={() =>
                          composer.update((current) => ({
                            artifactReferences: current.artifactReferences?.filter(
                              (item) => item.revisionId !== ref.revisionId,
                            ),
                          }))
                        }
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <form
                className={styles.composer}
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void send();
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (event.dataTransfer.files.length) {
                    event.preventDefault();
                    void importFiles([...event.dataTransfer.files]);
                  }
                }}
              >
                <ModeControl
                  provider={provider}
                  available={availableModes}
                  mode={mode}
                  disabled={!!active || sending || !composer.ready || state.loading}
                  onChange={(value) => {
                    setMode(value);
                    if (provider === 'codex' && value === 'review') setEffort('');
                  }}
                />
                {!!attachments.length && (
                  <div className={styles.attachments}>
                    {attachments.map((file) => (
                      <span key={file.assetId ?? file.path}>
                        <FileText size={13} />
                        <button
                          type="button"
                          className="textButton"
                          onClick={() => setAttachmentPreview(file)}
                        >
                          {file.name ?? file.path.split(/[\\/]/).at(-1)}
                        </button>
                        <button
                          type="button"
                          className="iconButton"
                          aria-label={`Remove ${file.path.split(/[\\/]/).at(-1)}`}
                          onClick={() =>
                            setAttachments(attachments.filter((a) => a.path !== file.path))
                          }
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textarea}
                  aria-label="Message"
                  placeholder={
                    mode === 'plan'
                      ? 'What would you like to plan?'
                      : mode === 'review'
                        ? 'What should we review?'
                        : mode === 'code' || isBypassMode(mode)
                          ? 'Describe what you want to build or change…'
                          : 'Ask anything, or add a file…'
                  }
                  value={text}
                  disabled={!composer.ready || state.loading || sending}
                  onPaste={(event) => {
                    const files = [...event.clipboardData.files];
                    if (files.length) {
                      event.preventDefault();
                      void importFiles(files);
                    }
                  }}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className={styles.composerToolbar}>
                  <div className={styles.composerControls}>
                    <Picker
                      label="Provider"
                      value={provider}
                      disabled={!!active || sending || !composer.ready || state.loading}
                      fallback={`${connection?.name ?? provider} (disabled)`}
                      options={snapshot.connections
                        .filter((c) => c.enabled)
                        .map((c) => ({
                          value: c.id,
                          label: c.name,
                          icon: <ProviderIcon provider={c.id} tiny />,
                        }))}
                      onChange={(value) => {
                        const id = value as ProviderId;
                        composer.update({
                          provider: id,
                          mode: capabilities(id).modes[0].id,
                          model: snapshot.connections.find((c) => c.id === id)?.model ?? '',
                          effort: '',
                          customModel: false,
                        });
                      }}
                    />
                    {customModel ? (
                      <input
                        className={styles.modelInput}
                        aria-label="Model ID"
                        value={model}
                        placeholder="Model ID"
                        disabled={!!active || sending || !composer.ready || state.loading}
                        autoFocus
                        onChange={(event) => {
                          setModel(event.target.value);
                          setEffort('');
                        }}
                        onBlur={() => {
                          setCustomModel(false);
                        }}
                      />
                    ) : (
                      <Picker
                        label="Model"
                        searchable
                        value={model}
                        disabled={!!active || sending || !composer.ready || state.loading}
                        onOpen={() => {
                          if (
                            (provider === 'codex' || connection?.kind === 'api-chat') &&
                            provider !== 'demo'
                          )
                            void window.desktop
                              .models(provider)
                              .then((options) => {
                                if (selectedProvider.current === provider) setModels(options);
                              })
                              .catch((error) => {
                                if (selectedProvider.current === provider) report(error);
                              });
                        }}
                        options={[
                          {
                            value: '',
                            label: 'Default model',
                            description: 'Uses your provider settings',
                            icon: <ProviderIcon provider={provider} tiny />,
                          },
                          ...models.map((option) => ({
                            value: option.id,
                            label: option.label,
                            icon: <ProviderIcon provider={provider} tiny />,
                          })),
                          ...(model && !models.some((option) => option.id === model)
                            ? [{ value: model, label: model }]
                            : []),
                          {
                            value: '__custom',
                            label: 'Custom model…',
                            description: 'Enter a model ID',
                          },
                        ]}
                        onChange={(value) => {
                          setEffort('');
                          if (value === '__custom') {
                            setCustomModel(true);
                            setModel('');
                          } else setModel(value);
                        }}
                      />
                    )}
                    {!!models.find((option) => option.id === model)?.efforts.length &&
                      !(provider === 'codex' && mode === 'review') && (
                        <Picker
                          label="Reasoning depth"
                          value={effort}
                          disabled={!!active || sending || !composer.ready || state.loading}
                          options={[
                            { value: '', label: 'Default depth' },
                            ...models
                              .find((option) => option.id === model)!
                              .efforts.map((level) => ({
                                value: level,
                                label: effortLabel(level),
                              })),
                          ]}
                          onChange={setEffort}
                        />
                      )}
                    <button
                      type="button"
                      className="iconButton"
                      aria-label="Attach files"
                      title="Attach images, PDF, text or code files"
                      disabled={
                        !!active || sending || !composer.ready || state.loading || preparing
                      }
                      onClick={() => void attachFiles()}
                    >
                      <Paperclip size={17} />
                    </button>
                    {workspaceProject && (
                      <button
                        type="button"
                        className="textButton"
                        disabled={!!active || preparing || sending || !composer.ready}
                        onClick={() => setFileSelectorOpen(true)}
                      >
                        Project file…
                      </button>
                    )}
                    <button
                      type="button"
                      className="textButton"
                      disabled={!composer.ready || state.loading || sending}
                      onClick={() => setContextToolsOpen(true)}
                    >
                      Add context and tools
                    </button>
                    {selectedId && connection?.kind === 'api-chat' && provider !== 'demo' && (
                      <button
                        type="button"
                        className="textButton"
                        onClick={() => {
                          setSourceDraftKey(draftKey);
                          setContextOpen(true);
                        }}
                      >
                        Context
                        {composer.draft.historyMessageIds
                          ? ` (${composer.draft.historyMessageIds.length})`
                          : ''}
                      </button>
                    )}
                  </div>
                  {active ? (
                    <button
                      type="button"
                      className={styles.send}
                      aria-label="Stop response"
                      onClick={() => window.desktop.cancel(selectedId!).catch(report)}
                    >
                      <Square size={15} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className={styles.send}
                      type="submit"
                      aria-label="Send message"
                      disabled={!text.trim() || sending || !canSubmit || !modelReady}
                    >
                      <ArrowUp size={19} />
                    </button>
                  )}
                </div>
              </form>
              <div className={styles.composerFooter}>
                <span>
                  {!isProviderAvailable(provider)
                    ? 'API providers are disabled. Choose a provider to continue.'
                    : !connection?.enabled
                      ? 'This connection is disabled. Enable it in Settings or choose another provider.'
                      : isBypassMode(mode)
                        ? 'Bypass permissions · full access'
                        : connection?.kind === 'cli-agent'
                          ? 'Your CLI account'
                          : provider === 'demo'
                            ? 'Local test · no network'
                            : 'API usage billing'}
                </span>
                {active && (
                  <span role="status" aria-live="polite">
                    {active.status === 'waiting'
                      ? 'Waiting for your input'
                      : 'Working on your request'}
                    {active.createdAt
                      ? ` · ${Math.max(0, Math.floor((clock - Date.parse(active.createdAt)) / 1000))}s`
                      : ''}
                  </span>
                )}
                {preparing && <span role="status">Preparing attachments…</span>}
                {availability?.usage && (
                  <span
                    title={`Checked ${new Date(availability.usage.checkedAt).toLocaleString()}`}
                  >
                    {availability.usage.windows
                      .map((w) => `${w.label}: ${w.remainingPercent}% left`)
                      .join(' · ')}
                  </span>
                )}
                {view?.usage && (
                  <span title={`Last reported ${new Date(view.usage.checkedAt).toLocaleString()}`}>
                    Last turn: {view.usage.inputTokens ?? '?'} input /{' '}
                    {view.usage.outputTokens ?? '?'} output tokens
                  </span>
                )}
                {active?.status === 'waiting' && (
                  <button
                    className="textButton"
                    onClick={() => {
                      timeline.current
                        ?.querySelector('.interaction')
                        ?.scrollIntoView({ block: 'center' });
                    }}
                  >
                    Answer request
                  </button>
                )}
              </div>
            </div>
            {state.terminal && workspaceProject && <Terminal projectId={workspaceProject.id} />}
          </div>
          {state.panel && workspaceProject && (
            <ContextPanel
              project={workspaceProject}
              onAttach={attach}
              onReview={(file) => {
                setReviewProvider(
                  snapshot.connections.find(
                    (c) => c.enabled && c.id !== provider && c.id !== 'demo',
                  )?.id ?? provider,
                );
                setReviewSource({
                  text: `Captured changes: ${file.path}\n\n${file.content}`,
                  projectId: project?.id ?? null,
                  workspaceId: workspace?.id ?? null,
                });
              }}
            />
          )}
        </div>
      </main>
      {state.settingsOpen && <Settings />}
      {instructionUpdate && (
        <Dialog
          title="Updated project instructions"
          wide
          onClose={() => {
            if (!instructionUpdateBusy) setInstructionUpdate(null);
          }}
        >
          <div className="dialogBody">
            <p>
              Use these instructions in a new fork. This chat keeps its captured instructions and
              unsent draft. The fork copies saved history and your current draft; no request is
              sent.
            </p>
            <p>
              Captured instructions:{' '}
              {instructionUpdate.previous.length
                ? instructionUpdate.previous
                    .map((source) => `${source.title} · revision ${source.revision}`)
                    .join(', ')
                : 'None'}
            </p>
            <p>
              Updated instructions:{' '}
              <strong>
                {instructionUpdate.next.title} · revision {instructionUpdate.next.revision}
              </strong>
            </p>
            <SourceSnapshots sources={[...instructionUpdate.previous, instructionUpdate.next]} />
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button
                className="button"
                disabled={instructionUpdateBusy}
                onClick={() => setInstructionUpdate(null)}
              >
                Keep captured instructions
              </button>
              <button
                className="button primary"
                disabled={instructionUpdateBusy}
                onClick={() => void forkWithUpdatedInstructions()}
              >
                {instructionUpdateBusy
                  ? 'Creating fork…'
                  : 'Use updated instructions in a new fork'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {contextToolsOpen && (
        <Dialog title="Context and tools" onClose={() => setContextToolsOpen(false)}>
          <div className={`dialogBody ${styles.contextToolActions}`}>
            {project && (
              <button
                className="button"
                onClick={() => {
                  setContextToolsOpen(false);
                  setSourceDraftKey(draftKey);
                  setKnowledgeProjectId(project.id);
                }}
              >
                Project knowledge
              </button>
            )}
            <button
              className="button"
              onClick={() => {
                setContextToolsOpen(false);
                openSources('web');
              }}
            >
              Web sources
            </button>
            <button
              className="button"
              onClick={() => {
                setContextToolsOpen(false);
                openSources('memory');
              }}
            >
              Memory
            </button>
            <button
              className="button"
              onClick={() => {
                setContextToolsOpen(false);
                openSources('prompts');
              }}
            >
              Prompt templates
            </button>
            <button
              className="button"
              onClick={() => {
                setContextToolsOpen(false);
                setSourceDraftKey(draftKey);
                setArtifactSelection(undefined);
                setArtifactProposal(undefined);
                setArtifactsOpen(true);
              }}
            >
              Attach artifact
            </button>
            <button
              className="button"
              disabled={!text.trim() || !!active || !composer.ready}
              onClick={() => {
                setContextToolsOpen(false);
                openComparison();
              }}
            >
              Compare models
            </button>
          </div>
        </Dialog>
      )}
      {newProjectOpen && (
        <Dialog
          title="Add project"
          onClose={() => {
            if (!creatingProject) setNewProjectOpen(false);
          }}
        >
          <div className="dialogBody">
            <fieldset disabled={creatingProject}>
              <legend>Project type</legend>
              <label>
                <input
                  type="radio"
                  name="projectKind"
                  checked={newProjectKind === 'chat'}
                  onChange={() => setNewProjectKind('chat')}
                />
                Chat project — conversations, instructions and knowledge
              </label>
              <label>
                <input
                  type="radio"
                  name="projectKind"
                  checked={newProjectKind === 'folder'}
                  onChange={() => setNewProjectKind('folder')}
                />
                Folder project — files, Git and terminal
              </label>
            </fieldset>
            {newProjectKind === 'chat' && (
              <label>
                Project name
                <input
                  autoFocus
                  aria-label="Project name"
                  value={newProjectName}
                  maxLength={80}
                  disabled={creatingProject}
                  onChange={(event) => setNewProjectName(event.target.value)}
                />
              </label>
            )}
            <button
              className="button primary"
              disabled={creatingProject || (newProjectKind === 'chat' && !newProjectName.trim())}
              onClick={() => void addProject()}
            >
              {creatingProject
                ? 'Creating…'
                : newProjectKind === 'folder'
                  ? 'Choose folder'
                  : 'Create chat project'}
            </button>
          </div>
        </Dialog>
      )}
      {knowledgeProjectId && (
        <KnowledgeLibrary
          key={knowledgeProjectId}
          projectId={knowledgeProjectId}
          onClose={() => setKnowledgeProjectId(null)}
          onInclude={(refs) => {
            if (project?.id !== knowledgeProjectId)
              throw new Error('Select this project before adding its knowledge to a conversation.');
            return includeSources(refs);
          }}
        />
      )}
      {sourceDialog === 'web' && (
        <WebSources
          key={sourceDraftKey}
          draftKey={sourceDraftKey}
          projectId={project?.id}
          contextRefs={composer.draft.contextRefs ?? []}
          onChange={(refs) => {
            if (currentDraftKey.current !== sourceDraftKey)
              throw new Error(
                'The conversation changed. Add web sources again in the intended conversation.',
              );
            composer.update({ contextRefs: refs });
          }}
          onError={report}
          onClose={() => setSourceDialog(null)}
        />
      )}
      {sourceDialog === 'memory' && (
        <MemoryLibrary
          key={`${project?.id ?? 'global'}:${memoryInitialNote?.source?.messageId ?? sourceDraftKey}`}
          api={window.desktop}
          projectId={project?.id ?? null}
          onClose={() => setSourceDialog(null)}
          initialNote={memoryInitialNote}
          onInclude={(source) => includeSources([{ snapshotId: source.id, included: true }])}
          onFreshChat={async () => {
            await newChat(true);
          }}
          onOpenSource={(id, messageId) => {
            setSourceDialog(null);
            void select(id, messageId);
          }}
        />
      )}
      {sourceDialog === 'prompts' && (
        <PromptLibrary
          projectId={project?.id}
          draftKey={sourceDraftKey}
          text={composer.draft.text}
          onClose={() => setSourceDialog(null)}
          onApply={(expectedKey, expectedText, nextText) => {
            if (
              currentDraftKey.current !== expectedKey ||
              composer.peek(expectedKey)?.text !== expectedText
            )
              return false;
            composer.update({ text: nextText });
            return true;
          }}
        />
      )}
      {tagsOpen && selectedId && (
        <TagPicker
          conversationId={selectedId}
          onChanged={refresh}
          onClose={() => setTagsOpen(false)}
        />
      )}
      {artifactsOpen && (
        <Artifacts
          projectId={project?.id}
          initialArtifactId={artifactSelection?.artifactId}
          initialRevisionId={artifactSelection?.revisionId}
          forkOnEdit={!!artifactSelection && !!view?.conversation.parentConversationId}
          proposal={artifactProposal}
          onClose={() => setArtifactsOpen(false)}
          onAskToRevise={prepareArtifactRevision}
          onAttach={(ref) => {
            if (currentDraftKey.current !== sourceDraftKey || !composer.ready || state.loading) {
              report(
                new Error(
                  'The conversation changed. Attach the artifact again in the intended conversation.',
                ),
              );
              return;
            }
            composer.update((current) => ({
              artifactReferences: [
                ...new Map(
                  [...(current.artifactReferences ?? []), ref].map((item) => [
                    item.revisionId,
                    item,
                  ]),
                ).values(),
              ],
            }));
            setArtifactsOpen(false);
          }}
        />
      )}
      {comparisonOpen && (
        <Comparison
          connections={snapshot.connections}
          input={comparisonInput}
          onClose={() => setComparisonOpen(false)}
          onContinue={async (conversation) => {
            setComparisonOpen(false);
            await select(conversation.id);
            await refresh();
          }}
        />
      )}
      {fileSelectorOpen && workspaceProject && (
        <FileSelector
          workspaceId={workspaceProject.id}
          onAttach={attach}
          onClose={() => setFileSelectorOpen(false)}
        />
      )}
      {reviewSource && (
        <Dialog title="Second opinion" onClose={() => setReviewSource(null)}>
          <div className="dialogBody">
            <p>
              Choose the provider to independently review the selected answer or captured changes.
              The review starts in read-only Chat.
            </p>
            <Picker
              label="Review provider"
              value={reviewProvider}
              options={(snapshot.connections ?? [])
                .filter((c) => c.enabled)
                .map((c) => ({ value: c.id, label: c.name }))}
              onChange={(id) => setReviewProvider(id as ProviderId)}
            />
            <p>
              {snapshot.connections.find((c) => c.id === reviewProvider)?.kind === 'api-chat'
                ? 'Sending the review uses separately billed API tokens.'
                : 'Sending the review uses this provider’s subscription allowance.'}{' '}
              You can inspect and edit the prompt before sending.
            </p>
            <button className="button primary" onClick={() => void prepareReview()}>
              Prepare review conversation
            </button>
          </div>
        </Dialog>
      )}
      {commandsOpen && (
        <CommandPalette
          onClose={() => setCommandsOpen(false)}
          actions={[
            { label: 'New conversation', run: () => void newChat() },
            {
              label: 'Search conversations',
              run: () => {
                setFindInChat(false);
                setSearchOpen(true);
              },
            },
            { label: 'Archive & backups', run: () => setArchiveOpen(true) },
            { label: 'Focus composer', run: () => textarea.current?.focus() },
            { label: 'Settings & connections', run: () => set({ settingsOpen: true }) },
            ...(workspaceProject
              ? [
                  { label: 'Open project files', run: () => set({ panel: 'files' }) },
                  { label: 'Review Git changes', run: () => set({ panel: 'git' }) },
                  { label: 'Show terminal', run: () => set({ terminal: true }) },
                ]
              : []),
          ]}
        />
      )}
      {searchOpen && (
        <HistoryBrowser
          projectId={state.projectId}
          conversationId={findInChat ? (selectedId ?? undefined) : undefined}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {archiveOpen && (
        <HistoryBrowser
          initialArchive
          projectId={state.projectId}
          onClose={() => setArchiveOpen(false)}
        />
      )}
      {contextOpen && selectedId && (
        <ContextSelection
          conversationId={selectedId}
          selectedIds={composer.draft.historyMessageIds}
          defaultSessionId={view?.currentSessionId}
          contextRefs={composer.draft.contextRefs}
          excludedIds={composer.draft.excludedContextSnapshotIds}
          onSourcesChange={(contextRefs, excludedContextSnapshotIds) =>
            currentDraftKey.current === sourceDraftKey &&
            composer.update({ contextRefs, excludedContextSnapshotIds })
          }
          onApply={(ids) => {
            if (currentDraftKey.current === sourceDraftKey)
              composer.update({ historyMessageIds: ids });
          }}
          onClose={() => setContextOpen(false)}
        />
      )}
      {attachmentPreview && (
        <AttachmentPreview
          attachment={attachmentPreview}
          onClose={() => setAttachmentPreview(null)}
          onChange={(next) =>
            setAttachments((current) => current.map((a) => (a.assetId === next.assetId ? next : a)))
          }
        />
      )}
      {filePreview && (
        <Dialog
          title={`${filePreview.path}${filePreview.line ? `:${filePreview.line}` : ''}`}
          wide
          onClose={() => setFilePreview(null)}
        >
          <div className="dialogBody">
            <pre className="filePreview">
              {filePreview.content.split('\n').map((line, index) => (
                <span
                  key={index}
                  data-line={index + 1}
                  className={index + 1 === filePreview.line ? 'highlightLine' : ''}
                >
                  {line}
                  {'\n'}
                </span>
              ))}
            </pre>
          </div>
        </Dialog>
      )}
      {managedProject && (
        <Dialog title="Project settings" onClose={() => setManagedProject(null)}>
          <div className="dialogBody">
            <h3>{managedProject.name}</h3>
            <p className="muted small">{managedProject.path}</p>
            <p>Removing this project keeps its files and conversations.</p>
            <button
              className="button"
              onClick={() => {
                setSourceDraftKey(draftKey);
                setKnowledgeProjectId(managedProject.id);
                setManagedProject(null);
              }}
            >
              Manage project knowledge
            </button>
            <ProjectTools
              project={managedProject}
              draft={composer.draft}
              onSaved={(defaults) => updateProjectDefaultDrafts(managedProject, defaults)}
            />
            <div className="row spread">
              <button
                className="textButton"
                onClick={async () => {
                  try {
                    await window.desktop.removeProject(managedProject.id);
                    setManagedProject(null);
                    set({ projectId: undefined });
                    await select(null);
                    await refresh();
                  } catch (error) {
                    report(error);
                  }
                }}
              >
                Remove from projects
              </button>
              {managedProject.kind === 'folder' && (
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      await window.desktop.trustProject(managedProject.id, !managedProject.trusted);
                      setManagedProject(null);
                      await refresh();
                    } catch (error) {
                      report(error);
                    }
                  }}
                >
                  {managedProject.trusted ? 'Revoke trust' : 'Trust project'}
                </button>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {handoff !== null && (
        <Dialog title="Share context with a new session" onClose={() => setHandoff(null)}>
          <div className="dialogBody">
            <p>
              Review exactly what {connection?.name} will receive. Its own session starts fresh.
              This preview includes saved messages, including those outside the loaded page. Edit it
              to choose what carries forward.
            </p>
            <textarea
              aria-label="Context handoff"
              className="handoffEditor"
              value={handoff}
              onChange={(e) => setHandoff(e.target.value)}
            />
            <p className="small muted">
              {handoff.length.toLocaleString()} / 100,000 characters. No hidden reasoning or tool
              state is transferred.
            </p>
            {!!handoffCaptures.length && (
              <fieldset>
                <legend>Captured sources for this handoff</legend>
                <p className="muted small">
                  These snapshots travel separately from the editable transcript. Excluded notes
                  remain outside the new session.
                </p>
                {handoffCaptures.map((capture) => (
                  <label key={capture.ref.snapshotId}>
                    <input
                      type="checkbox"
                      checked={capture.ref.included}
                      onChange={(event) =>
                        setHandoffCaptures((current) =>
                          current.map((item) =>
                            item.ref.snapshotId === capture.ref.snapshotId
                              ? { ...item, ref: { ...item.ref, included: event.target.checked } }
                              : item,
                          ),
                        )
                      }
                    />
                    {capture.source.title} · {capture.source.kind} · revision{' '}
                    {capture.source.revision}
                  </label>
                ))}
                <p>
                  {handoffCaptures.filter((capture) => capture.ref.included).length} / 30 sources
                  selected.
                </p>
                <SourceSnapshots sources={handoffCaptures.map((capture) => capture.source)} />
              </fieldset>
            )}
            <div className="row end">
              <button
                className="button"
                disabled={sending || !canSubmit}
                onClick={() => void send('')}
              >
                Start without history
              </button>
              <button
                className="button primary"
                disabled={
                  handoff.length > 100000 ||
                  !handoff.trim() ||
                  handoffCaptures.filter((capture) => capture.ref.included).length > 30 ||
                  sending ||
                  !canSubmit
                }
                onClick={() => void send(handoff)}
              >
                Share and send
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {rename !== null && selectedId && (
        <Dialog title="Conversation" onClose={() => setRename(null)}>
          <div className="dialogBody">
            <label>
              Title
              <input value={rename} onChange={(e) => setRename(e.target.value)} />
            </label>
            <div className="row">
              <button
                className="button"
                onClick={() => {
                  setRename(null);
                  setTagsOpen(true);
                }}
              >
                Manage tags
              </button>
              <button
                className="button"
                onClick={() =>
                  void window.desktop
                    .pinConversation(selectedId, !view?.conversation.pinned)
                    .then(refresh)
                    .catch(report)
                }
              >
                {view?.conversation.pinned ? 'Unpin' : 'Pin'} conversation
              </button>
              {(['markdown', 'json', 'pdf'] as const).map((format) => (
                <button
                  key={format}
                  className="button"
                  onClick={() =>
                    void window.desktop.exportConversation(selectedId, format).catch(report)
                  }
                >
                  Export {format.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="row spread">
              <button
                className="textButton"
                disabled={!!active}
                onClick={async () => {
                  try {
                    await window.desktop.archiveConversation(selectedId);
                    setRename(null);
                    await select(null);
                    await refresh();
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                Archive conversation
              </button>
              <button
                className="button primary"
                onClick={async () => {
                  try {
                    await window.desktop.renameConversation(selectedId, rename);
                    setRename(null);
                    await refresh();
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
function InteractionCard({ interaction: i }: { interaction: Interaction }) {
  const { report } = useApp();
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});
  const [busy, setBusy] = useState(false);
  async function reply(allow: boolean) {
    setBusy(true);
    try {
      await window.desktop.reply({ id: i.id, allow, answers });
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="interaction">
      <div className="row">
        <ShieldCheck size={18} />
        <h3>{i.title}</h3>
      </div>
      {i.detail &&
        (i.kind === 'approval' ? (
          <pre className="approvalDetail">{i.detail}</pre>
        ) : (
          <Markdown text={i.detail} />
        ))}
      {i.questions && (
        <QuestionFields
          questions={i.questions}
          answers={answers}
          onChange={setAnswers}
          disabled={busy}
        />
      )}
      <div className="row end">
        <button className="button" disabled={busy} onClick={() => void reply(false)}>
          Decline
        </button>
        <button
          className="button primary"
          disabled={
            busy || (i.kind === 'question' && !questionAnswersValid(i.questions ?? [], answers))
          }
          onClick={() => void reply(true)}
        >
          {i.kind === 'question'
            ? 'Send answer'
            : i.kind === 'plan'
              ? 'Acknowledge plan'
              : 'Allow once'}
        </button>
      </div>
    </section>
  );
}

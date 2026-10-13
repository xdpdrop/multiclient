import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { Store } from './storage/store';
import { Coordinator } from './conversations/coordinator';
import { routes, connectionSchema, type Route } from '../shared/schema';
import {
  connections,
  isProviderAvailable,
  assertProviderAvailable,
  capabilities,
} from '../shared/defaults';
import { modelCatalog } from '../shared/models';
import { canonicalDirectory, listFiles, readText } from './files';
import { findProjectFiles, readInstructions } from './files/navigation';
import { gitState } from './git';
import { createManagedWorktree } from './git/worktrees';
import { Terminals } from './terminals';
import { probe } from './providers';
import { findExecutable, launch, stopAll, setProcessSupervisor } from './providers/process';
import { CodexConnection } from './providers/codex';
import { validateEndpoint, listApiModels, testApiConnection } from './providers/api';
import { validateRestoredDatabase } from './storage/backup';
import { importAttachment, importAttachmentBytes } from './files/attachments';
import { OrganizationService } from './organization';
import { organizationRoutes } from '../shared/organization';
import { createContextHandlers } from './context';
import { ContextStore } from './context/storage';
import { contextRoutes } from '../shared/context';
import { createMemoryHandlers } from './memory';
import { memoryRoutes } from '../shared/memory';
import { handleArtifactRoute } from './artifacts/handlers';
import { artifactRuntimeRoutes, type ArtifactRoute } from '../shared/artifacts';
import { createResearchHandlers } from './research';
import { researchRoutes } from '../shared/research';
import { comparisonHandlers } from './comparison';
import { comparisonRoutes } from '../shared/comparison';
import { attachmentSchema } from '../shared/schema';
import type {
  Availability,
  Connection,
  ProviderId,
  CredentialId,
  RuntimeEvent,
} from '../shared/types';

const parent = process.parentPort!;
const send = (value: unknown) => parent.postMessage(value);
let store: Store;
let coordinator: Coordinator;
let terminals: Terminals;
let organization: OrganizationService;
let contextHandlers: ReturnType<typeof createContextHandlers>;
let memoryHandlers: ReturnType<typeof createMemoryHandlers>;
let research: ReturnType<typeof createResearchHandlers>;
let comparisons: ReturnType<typeof comparisonHandlers>;
const comparisonSchemas = comparisonRoutes(attachmentSchema);
let dataDir = '';
let bridgePath = '';
let migrationsPath = '';
let availability: Availability[] = [];
let checkingConnections: Promise<Availability[]> | undefined;
let checkingConfiguration = '';
let credentialsSerial = 0;
const credentials = new Map<number, (secret: string | undefined) => void>();
const loginConnections = new Set<CodexConnection>();
const emit = (event: RuntimeEvent) => send({ type: 'event', event });
const changed = () => emit({ type: 'changed' });
function secret(id: CredentialId): Promise<string | undefined> {
  const requestId = ++credentialsSerial;
  return new Promise((resolve) => {
    credentials.set(requestId, resolve);
    send({ type: 'secret', requestId, providerId: id });
  });
}

function checkConnections(): Promise<Availability[]> {
  const configuration = JSON.stringify(
    store
      .connections()
      .map((c) => [c.id, store.configurationRevision(c.id), c.configured, c.enabled]),
  );
  if (checkingConnections && configuration !== checkingConfiguration)
    return checkingConnections.then(() => checkConnections());
  checkingConfiguration = configuration;
  checkingConnections ??= Promise.all(
    store
      .connections()
      .filter((c) => c.id !== 'demo' && isProviderAvailable(c.id))
      .map(async (config) => {
        const revision = store.configurationRevision(config.id);
        const result = await probe(config);
        if (store.configurationRevision(config.id) === revision) {
          const previous = availability.find((a) => a.id === config.id);
          const effective =
            config.kind === 'api-chat' && previous?.test?.passed && result.status === 'unknown'
              ? {
                  ...result,
                  status: 'ready' as const,
                  detail: previous.test.detail,
                  test: previous.test,
                }
              : { ...result, test: previous?.test };
          availability = [...availability.filter((a) => a.id !== config.id), effective];
          changed();
        }
      }),
  )
    .then(() => availability)
    .finally(() => {
      checkingConnections = undefined;
    });
  return checkingConnections;
}

async function dispatch(route: Route, raw: unknown): Promise<unknown> {
  const input: any = routes[route].parse(raw);
  if (route in contextRoutes) return contextHandlers[route as keyof typeof contextHandlers](input);
  if (route in researchRoutes) return research.routes[route as keyof typeof research.routes](input);
  if (route in comparisonSchemas) return comparisons[route as keyof typeof comparisons](input);
  if (route in memoryRoutes) {
    const result = memoryHandlers[route as keyof typeof memoryHandlers](input);
    if (['memorySave', 'memoryDelete'].includes(route)) changed();
    return result;
  }
  if ((artifactRuntimeRoutes as string[]).includes(route)) {
    const result = handleArtifactRoute(store, route as ArtifactRoute, input);
    if (!['artifactsList', 'artifactRead'].includes(route)) changed();
    return result;
  }
  if (route in organizationRoutes) {
    const result = organization.dispatch(route as keyof typeof organizationRoutes, input);
    if (!['tags', 'conversationTags', 'promptTemplates'].includes(route)) changed();
    return result;
  }
  switch (route) {
    case 'snapshot':
      return {
        projects: store.projects(),
        workspaces: store.workspaces(),
        conversations: organization.enrich(store.conversations()),
        connections: store.connections(),
        availability,
        settings: store.settings(),
        activeTurns: coordinator.activeTurns(),
      };
    case 'conversation':
      return store.view(input.id, input.before);
    case 'conversationAround':
      return store.view(input.id, undefined, input.messageId);
    case 'transcript':
      return store.messages(input.id);
    case 'search':
      return organization.search(input.query, input);
    case 'archivedConversations':
      return organization.enrich(store.conversations(true));
    case 'restoreConversation':
      store.restoreConversation(input.id);
      changed();
      return;
    case 'pinConversation':
      store.pin(input.id, input.pinned);
      changed();
      return;
    case 'branchConversation': {
      if (coordinator.activeTurns().some((t) => t.conversationId === input.id))
        throw new Error('Stop the active turn before branching.');
      const c = store.branch(input.id, input.messageId, input.edit);
      changed();
      return c;
    }
    case 'draft':
      return store.draft(input.key);
    case 'saveDraft':
      store.saveDraft(input.key, input.draft);
      return;
    case 'projectDefaults':
      return store.projectDefaults(input.projectId);
    case 'saveProjectDefaults':
      store.saveProjectDefaults(input.projectId, input.defaults);
      return;
    case 'instructions':
      return store.project(input.projectId).path
        ? readInstructions(store.project(input.projectId).path!)
        : [];
    case 'exportData':
      return store.exportData(input.id);
    case 'importData': {
      const c = store.importData(input.data, input.data.assets);
      changed();
      return c;
    }
    case 'backupData':
      return store.backup(input.path);
    case 'validateBackup':
      return validateRestoredDatabase(input.path, migrationsPath);
    case 'prepareAttachment': {
      const imported = await importAttachment(input.path, dataDir);
      if (imported.asset) store.registerAsset(imported.asset);
      return imported.attachment;
    }
    case 'prepareAttachmentBytes': {
      const imported = await importAttachmentBytes(
        Uint8Array.from(input.bytes),
        input.name,
        input.mime,
        dataDir,
      );
      if (imported.asset) store.registerAsset(imported.asset);
      return imported.attachment;
    }
    case 'createConversation': {
      const c = store.createConversation(input.projectId, input.workspaceId);
      changed();
      return c;
    }
    case 'createWorktree': {
      const p = store.project(input.projectId);
      if (!p.path || !p.workspaceId)
        throw new Error('Choose a folder project to create a workspace.');
      if (!p.trusted) throw new Error('Trust this project before creating a managed workspace.');
      if (coordinator.busyProject(p.workspaceId))
        throw new Error('Stop the source workspace agent before creating a worktree.');
      const tree = await createManagedWorktree(p.path, dataDir, input.sourceRef);
      if (!store.project(p.id).trusted)
        throw new Error(
          'Project trust changed. The created worktree is preserved in application storage.',
        );
      const workspace = store.addWorkspace(p.id, tree.path, tree.branch, tree.sourceRef);
      changed();
      return workspace;
    }
    case 'archiveWorkspace': {
      const workspace = store.workspace(input.workspaceId);
      if (coordinator.busyProject(workspace.id))
        throw new Error('Stop this workspace agent before archiving.');
      store.archiveWorkspace(workspace.id);
      terminals.closeWorkspace(workspace.id);
      changed();
      return;
    }
    case 'restoreWorkspace': {
      const workspace = store.workspace(input.workspaceId);
      if ((await canonicalDirectory(workspace.path)) !== workspace.path)
        throw new Error(
          'The workspace location changed. Its saved checkout must be recovered before restoring.',
        );
      store.restoreWorkspace(workspace.id);
      changed();
      return;
    }
    case 'archiveConversation':
      if (coordinator.activeTurns().some((t) => t.conversationId === input.id))
        throw new Error('Stop the active turn before archiving.');
      store.archive(input.id);
      changed();
      return;
    case 'renameConversation':
      store.rename(input.id, input.title);
      changed();
      return;
    case 'addProject': {
      const p = store.addProject(await canonicalDirectory(input.path));
      changed();
      return p;
    }
    case 'trustProject':
    case 'removeProject': {
      const p = store.project(input.id);
      const workspaces = store.workspaces().filter((w) => w.projectId === p.id);
      if (workspaces.some((w) => coordinator.busyProject(w.id)))
        throw new Error('Stop the agent before changing this project.');
      if (route === 'trustProject') store.trustProject(input.id, input.trusted);
      else store.removeProject(input.id);
      if (route === 'removeProject' || !input.trusted)
        for (const w of workspaces) terminals.closeWorkspace(w.id);
      changed();
      return;
    }
    case 'send':
      return coordinator.send(input);
    case 'cancel':
      return coordinator.cancel(input.conversationId);
    case 'reply':
      coordinator.broker.reply(input);
      changed();
      return;
    case 'saveConnection': {
      assertProviderAvailable(input.id);
      const known = connections.find((c) => c.id === input.id);
      if (!known) throw new Error('Unknown provider.');
      const config: Connection = connectionSchema.parse({
        ...input,
        name: known.name,
        kind: known.kind,
        configured: store.connection(input.id).configured,
      });
      if (known.kind === 'api-chat' && config.endpoint) validateEndpoint(config.endpoint);
      const previous = store.connection(config.id);
      if (
        known.kind === 'cli-agent' &&
        config.executable &&
        config.executable !== previous.executable
      )
        await findExecutable(config.id, config.executable);
      if (config.executable !== previous.executable)
        availability = availability.filter((a) => a.id !== config.id);
      store.saveConnection(config);
      availability = availability.filter((a) => a.id !== config.id);
      changed();
      return;
    }
    case 'probe':
      return checkConnections();
    case 'settings':
      store.saveSettings(input);
      changed();
      return;
    case 'settingsPatch': {
      const settings = store.patchSettings(input);
      changed();
      return settings;
    }
    case 'credentialState': {
      const c = store.connection(input.id);
      if (c.kind !== 'api-chat') throw new Error('CLI credentials are owned by the provider.');
      store.saveConnection({ ...c, configured: input.configured });
      if (input.changed) store.credentialChanged(input.id);
      availability = availability.filter((a) => a.id !== input.id);
      changed();
      return;
    }
    case 'login': {
      const config = store.connection(input.id);
      if (config.kind !== 'cli-agent') throw new Error('Configure API credentials in Connections.');
      const executable = await findExecutable(config.id, config.executable);
      if (config.id === 'codex') {
        const c = new CodexConnection({
          cwd: dataDir,
          dataDir,
          bridgePath,
          executable,
          connection: config,
          signal: new AbortController().signal,
          emit: () => {},
          interact: async () => {
            throw new Error('No agent interaction during sign-in.');
          },
        });
        try {
          await c.initialize();
          const result = await c.login();
          loginConnections.add(c);
          setTimeout(
            () => {
              loginConnections.delete(c);
              void c.close();
            },
            5 * 60 * 1000,
          );
          return result;
        } catch (e) {
          await c.close();
          throw e;
        }
      }
      const child = launch(
        executable,
        config.id === 'claude-code' ? ['auth', 'login'] : ['login'],
        dataDir,
      );
      child.stdout.resume();
      child.stderr.resume();
      child.on('error', () =>
        emit({
          type: 'runtime-error',
          message: 'Could not start provider login. Run the official CLI login in your terminal.',
        }),
      );
      return {
        message:
          'The official CLI is opening its sign-in flow. If no browser opens, run its login command in your terminal, then refresh Connections.',
      };
    }
    case 'models': {
      assertProviderAvailable(input.id);
      const apiConfig = store.connection(input.id);
      if (apiConfig.kind === 'api-chat' && input.id !== 'demo')
        return listApiModels(apiConfig, await secret(input.id));
      if (input.id !== 'codex') return modelCatalog(input.id);
      const config = store.connection('codex');
      const executable = await findExecutable('codex', config.executable);
      const c = new CodexConnection({
        cwd: dataDir,
        dataDir,
        bridgePath,
        executable,
        connection: config,
        signal: new AbortController().signal,
        emit: () => {},
        interact: async () => {
          throw new Error('Unsupported');
        },
      });
      try {
        await c.initialize();
        return await c.models();
      } finally {
        await c.close();
      }
    }
    case 'testConnection': {
      const config = store.connection(input.id);
      if (config.kind === 'api-chat' && input.id !== 'demo') {
        const revision = store.configurationRevision(config.id);
        let result: { message: string };
        try {
          result = await testApiConnection(config, await secret(input.id));
        } catch (error) {
          if (store.configurationRevision(config.id) === revision) {
            availability = [
              ...availability.filter((a) => a.id !== config.id),
              {
                id: config.id,
                installed: true,
                status: 'error',
                detail: 'The explicit connection test failed.',
                capabilities: capabilities(config.id),
                test: {
                  checkedAt: new Date().toISOString(),
                  passed: false,
                  detail: 'The explicit connection test failed.',
                },
              },
            ];
            changed();
          }
          throw error;
        }
        if (store.configurationRevision(config.id) !== revision)
          throw new Error(
            'Connection changed during the test. Test the saved configuration again.',
          );
        availability = [
          ...availability.filter((a) => a.id !== config.id),
          {
            id: config.id,
            installed: true,
            status: 'ready',
            detail: result.message,
            capabilities: capabilities(config.id),
            test: { checkedAt: new Date().toISOString(), passed: true, detail: result.message },
          },
        ];
        changed();
        return result;
      }
      const status = await probe(config);
      if (status.status !== 'ready') throw new Error(status.detail);
      return { message: status.detail + ' No prompt was sent.' };
    }
    case 'files':
      return listFiles(store.resolveWorkspace(input.projectId).path, input.path);
    case 'readFile':
      return readText(store.resolveWorkspace(input.projectId).path, input.path);
    case 'findFiles':
      return findProjectFiles(store.resolveWorkspace(input.projectId).path, input.query);
    case 'git':
      return gitState(store.resolveWorkspace(input.projectId).path);
    case 'terminalOpen': {
      const p = store.resolveWorkspace(input.projectId);
      if (!p.trusted) throw new Error('Trust this project before starting a terminal.');
      if (p.archived)
        throw new Error('Restore or choose an active workspace before opening a terminal.');
      return terminals.open(p.path, p.id);
    }
    case 'terminalWrite':
      terminals.write(input.id, input.data);
      return;
    case 'terminalResize':
      terminals.resize(input.id, input.cols, input.rows);
      return;
    case 'terminalClose':
      terminals.close(input.id);
      return;
    case 'registerAsset':
      store.registerAsset(input);
      return;
    case 'asset':
      return store.asset(input.id);
  }
}
parent.on('message', async ({ data }: { data: any }) => {
  if (data.type === 'secret') {
    credentials.get(data.requestId)?.(data.value);
    credentials.delete(data.requestId);
    return;
  }
  if (data.type === 'init') {
    try {
      dataDir = data.dataDir;
      setProcessSupervisor(send);
      bridgePath = data.bridgePath;
      migrationsPath = data.migrations;
      await mkdir(dataDir, { recursive: true });
      store = new Store(join(dataDir, 'multiclient.sqlite'), data.migrations);
      organization = new OrganizationService(store.db);
      contextHandlers = createContextHandlers(store, changed);
      memoryHandlers = createMemoryHandlers(store, new ContextStore(store));
      if (process.env.MULTICLIENT_TEST_MODE === '1')
        store.saveConnection({
          id: 'demo',
          name: 'Local test provider',
          kind: 'api-chat',
          executable: '',
          endpoint: '',
          model: '',
          enabled: true,
          configured: true,
        });
      coordinator = new Coordinator(store, dataDir, bridgePath, emit, secret);
      research = createResearchHandlers({
        store,
        dataDir,
        emit,
        secret: () => secret('brave-search'),
      });
      comparisons = comparisonHandlers({ store, coordinator, dataDir, secret, changed });
      terminals = new Terminals(emit);
      send({ type: 'ready' });
    } catch (e) {
      send({ type: 'fatal', error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  if (data.type === 'shutdown') {
    research?.dispose();
    await coordinator?.close();
    terminals?.closeAll();
    for (const c of loginConnections) await c.close();
    await stopAll();
    store?.close();
    process.exit(0);
  }
  if (data.type === 'request') {
    try {
      if (!store || !(data.route in routes)) throw new Error('Runtime is unavailable.');
      const result = await dispatch(data.route, data.input);
      send({ type: 'response', id: data.id, result });
    } catch (e) {
      send({ type: 'response', id: data.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
});

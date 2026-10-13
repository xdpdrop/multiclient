import type { Capabilities, Connection, ProviderId, Settings } from './types';
export function isProviderAvailable(id: ProviderId): boolean {
  return ['codex', 'claude-code', 'cursor', 'openai', 'anthropic', 'compatible', 'demo'].includes(
    id,
  );
}
export function assertProviderAvailable(id: ProviderId): void {
  if (!isProviderAvailable(id)) throw new Error('This provider is unavailable.');
}
export const defaultSettings: Settings = {
  appearance: {
    theme: 'light',
    background: null,
    backgroundType: 'image',
    backgroundOpacity: 1,
    surfaceOpacity: 0.82,
    dimming: 0.08,
    blur: 0,
    reducedMotion: false,
  },
  sidebarCollapsed: false,
  terminalOpen: false,
};
export const connections: Connection[] = [
  {
    id: 'codex',
    name: 'Codex',
    kind: 'cli-agent',
    executable: '',
    endpoint: '',
    model: '',
    enabled: true,
    configured: false,
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'cli-agent',
    executable: '',
    endpoint: '',
    model: '',
    enabled: true,
    configured: false,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'cli-agent',
    executable: '',
    endpoint: '',
    model: '',
    enabled: true,
    configured: false,
  },
  {
    id: 'openai',
    name: 'OpenAI API',
    kind: 'api-chat',
    executable: '',
    endpoint: 'https://api.openai.com/v1',
    model: '',
    enabled: true,
    configured: false,
  },
  {
    id: 'anthropic',
    name: 'Anthropic API',
    kind: 'api-chat',
    executable: '',
    endpoint: 'https://api.anthropic.com/v1',
    model: '',
    enabled: true,
    configured: false,
  },
  {
    id: 'compatible',
    name: 'Compatible API',
    kind: 'api-chat',
    executable: '',
    endpoint: '',
    model: '',
    enabled: true,
    configured: false,
  },
];
export function capabilities(provider: ProviderId): Capabilities {
  const cli = ['codex', 'claude-code', 'cursor'].includes(provider);
  return {
    modes: [
      {
        id: cli ? 'ask' : 'chat',
        label: cli ? 'Ask' : 'Chat',
        intent: cli ? 'ask' : 'chat',
        implementation: cli ? 'app-workflow' : 'native',
        workspaceAccess: cli ? 'read' : 'none',
      },
      ...(cli
        ? [
            {
              id: 'code',
              label: 'Code',
              intent: 'agent' as const,
              implementation: 'native' as const,
              workspaceAccess: 'write' as const,
            },
            {
              id: 'code-bypass',
              label: 'Bypass',
              intent: 'agent' as const,
              implementation: 'native' as const,
              workspaceAccess: 'write' as const,
            },
            {
              id: 'plan',
              label: 'Plan',
              intent: 'plan' as const,
              implementation:
                provider === 'codex' ? ('app-workflow' as const) : ('native' as const),
              workspaceAccess: 'read' as const,
            },
            {
              id: 'review',
              label: 'Review',
              intent: 'review' as const,
              implementation:
                provider === 'codex' ? ('native' as const) : ('app-workflow' as const),
              workspaceAccess: 'read' as const,
            },
          ]
        : []),
    ],
    resume: cli ? 'native' : 'transcript',
    cancellation: provider === 'claude-code' ? 'process' : cli ? 'protocol' : 'request',
    approvals: cli,
    userQuestions: cli,
    modelDiscovery: provider === 'codex' || !cli,
    inputKinds:
      provider === 'openai' || provider === 'anthropic'
        ? ['text', 'file-reference', 'image', 'pdf']
        : provider === 'compatible'
          ? ['text', 'file-reference', 'pdf']
          : ['text', 'file-reference'],
  };
}

import type { ModelOption, ProviderId } from './types';

export function modelCatalog(provider: ProviderId): ModelOption[] {
  if (provider !== 'claude-code') return [];
  // Official CLI aliases resolve according to the user's subscription and installed CLI.
  return [
    { id: 'opus', label: 'Claude Opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'sonnet', label: 'Claude Sonnet', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'haiku', label: 'Claude Haiku', efforts: [] },
  ];
}

export function effortLabel(effort: string) {
  return effort === 'xhigh' ? 'Extra high' : effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function supportsNativeAttachment(
  provider: ProviderId,
  model: string,
  kind: 'image' | 'pdf',
) {
  if (provider === 'anthropic')
    // Documented serving families; retired IDs and arbitrary new revisions are excluded.
    return /^claude-(?:sonnet-(?:4-[56]|5(?:-5)?)|opus-(?:4-[5-8]|5(?:-5)?)|haiku-(?:4-5|5-5))(?:-\d{8}|-latest)?$/.test(
      model,
    );
  if (provider !== 'openai') return false;
  if (/audio|realtime|image|transcrib|tts|search/.test(model)) return false;
  return /^gpt-(?:4o(?:-|$)|4\.1(?:-|$)|[56](?:[.-]|$))/.test(model);
}

export const localEndpointPresets = [
  { label: 'Ollama', endpoint: 'http://localhost:11434/v1' },
  { label: 'LM Studio', endpoint: 'http://localhost:1234/v1' },
];

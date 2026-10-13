import { capabilities } from './defaults';
import type { Capabilities, ProviderId } from './types';

export type ProviderCertification = {
  providerId: ProviderId;
  version: string;
  platform: string;
  readOnly: 'live-verified' | 'protocol-only';
  execution: 'partial' | 'unverified';
};

// These records describe actual evidence, not a claim of complete sandbox certification.
export const providerCertifications: ProviderCertification[] = [
  {
    providerId: 'codex',
    version: '0.158.0',
    platform: 'win32',
    readOnly: 'live-verified',
    execution: 'partial',
  },
  {
    providerId: 'claude-code',
    version: '2.1.252',
    platform: 'win32',
    readOnly: 'protocol-only',
    execution: 'unverified',
  },
];

export function installedVersion(value: string) {
  return value.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? '';
}

export function certification(providerId: ProviderId, version: string, platform: string) {
  return providerCertifications.find(
    (record) =>
      record.providerId === providerId &&
      record.version === installedVersion(version) &&
      record.platform === platform,
  );
}

export function effectiveCapabilities(
  providerId: ProviderId,
  version = '',
  platform = '',
  development = false,
): Capabilities {
  const base = capabilities(providerId);
  const record = certification(providerId, version, platform);
  // Public execution stays unavailable until the complete permission checklist is certified.
  const execution = development && ['codex', 'claude-code', 'cursor'].includes(providerId);
  const readModes = development || record?.readOnly === 'live-verified';
  return {
    ...base,
    modes: base.modes.filter((mode) =>
      mode.workspaceAccess === 'write'
        ? execution
        : readModes || mode.id === 'ask' || mode.id === 'chat',
    ),
    approvals: execution && base.approvals,
  };
}

export function assertCertifiedMode(
  providerId: ProviderId,
  mode: string,
  version: string,
  platform: string,
  development = false,
) {
  if (
    !effectiveCapabilities(providerId, version, platform, development).modes.some(
      (option) => option.id === mode,
    )
  )
    throw new Error(
      'This mode is unavailable for the installed provider version and platform. Ask remains available; Plan and Review depend on the verified version. Execution modes require complete permission verification before public release.',
    );
}

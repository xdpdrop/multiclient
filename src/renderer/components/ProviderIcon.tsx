import { FlaskConical, Plug } from 'lucide-react';
import type { ProviderId } from '../../shared/types';
import codex from '../assets/providers/codex.png';
import claude from '../assets/providers/claude.png';
import cursorLight from '../assets/providers/cursor-light.svg';
import cursorDark from '../assets/providers/cursor-dark.svg';
import openai from '../assets/providers/openai.png';
import anthropic from '../assets/providers/anthropic.png';

const images: Partial<Record<ProviderId, string>> = {
  codex,
  'claude-code': claude,
  cursor: cursorLight,
  openai,
  anthropic,
};

export function ProviderIcon({ provider, tiny = false }: { provider: ProviderId; tiny?: boolean }) {
  const source = images[provider];
  return (
    <span
      className={`providerBadge ${tiny ? 'tiny' : ''}`}
      data-provider-logo={provider}
      aria-hidden="true"
    >
      {source ? (
        <>
          <img
            src={source}
            alt=""
            className={provider === 'cursor' ? 'providerLogoLight' : undefined}
          />
          {provider === 'cursor' && <img src={cursorDark} alt="" className="providerLogoDark" />}
        </>
      ) : provider === 'demo' ? (
        <FlaskConical size={tiny ? 15 : 22} />
      ) : (
        <Plug size={tiny ? 15 : 22} />
      )}
    </span>
  );
}

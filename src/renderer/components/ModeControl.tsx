import { Code2, ListChecks, MessageSquare, ScanText, ShieldCheck, ShieldOff } from 'lucide-react';
import { capabilities } from '../../shared/defaults';
import { isBypassMode, isCodeMode } from '../../shared/modes';
import type { Mode, ProviderId } from '../../shared/types';
import { Picker } from './Picker';
import styles from './ModeControl.module.css';

const modes = {
  ask: {
    label: 'Chat',
    description: 'Ask questions and explore files. No changes.',
    icon: MessageSquare,
  },
  code: { label: 'Code', description: 'Edit project files and run commands.', icon: Code2 },
  plan: {
    label: 'Plan',
    description: 'Work through an approach before making changes.',
    icon: ListChecks,
  },
  review: {
    label: 'Review',
    description: 'Inspect changes and find issues. No edits.',
    icon: ScanText,
  },
};

export function ModeControl({
  provider,
  mode,
  disabled,
  onChange,
  available: advertised,
}: {
  provider: ProviderId;
  mode: string;
  disabled: boolean;
  onChange: (mode: string) => void;
  available?: Mode[];
}) {
  const available = advertised ?? capabilities(provider).modes;
  const supported = available.some((option) => option.id === mode);
  if (available.length < 2 && supported) return null;
  return (
    <div className={styles.bar}>
      <Picker
        label="Mode"
        value={supported && isCodeMode(mode) ? 'code' : mode}
        fallback={`${modes[(isCodeMode(mode) ? 'code' : mode) as keyof typeof modes]?.label ?? mode} (unavailable)`}
        disabled={disabled}
        options={available
          .filter((option) => !isBypassMode(option.id))
          .map((option) => {
            const presentation = modes[option.id as keyof typeof modes];
            const Icon = presentation?.icon ?? MessageSquare;
            return {
              value: option.id,
              label: presentation?.label ?? option.label,
              description: presentation?.description,
              icon: <Icon size={15} />,
            };
          })}
        onChange={onChange}
      />
      {supported && isCodeMode(mode) ? (
        <div className={styles.permissions} data-bypass={isBypassMode(mode)}>
          <Picker
            label="Permissions"
            value={mode}
            disabled={disabled}
            options={[
              {
                value: 'code',
                label: 'With approvals',
                description: 'Use the provider’s approval policy for edits and commands.',
                icon: <ShieldCheck size={15} />,
              },
              ...(available.some((option) => isBypassMode(option.id))
                ? [
                    {
                      value: 'code-bypass',
                      label: 'Bypass approvals',
                      description:
                        'Run without permission prompts. Full access, including outside this project.',
                      icon: <ShieldOff size={15} />,
                    },
                  ]
                : []),
            ]}
            onChange={onChange}
          />
        </div>
      ) : (
        <span className={styles.hint}>
          {supported ? 'No file changes' : 'Choose an available mode'}
        </span>
      )}
    </div>
  );
}

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import styles from './Picker.module.css';

type Option = { value: string; label: string; description?: string; icon?: ReactNode };
export function filterPickerOptions(options: Option[], query: string) {
  const search = query.trim().toLowerCase();
  return search
    ? options.filter((option) =>
        `${option.label} ${option.value} ${option.description ?? ''}`
          .toLowerCase()
          .includes(search),
      )
    : options;
}
export function Picker({
  label,
  value,
  options,
  fallback,
  disabled,
  onChange,
  onOpen,
  searchable = false,
}: {
  label: string;
  value: string;
  options: Option[];
  fallback?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onOpen?: () => void;
  searchable?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.value === value);
  const visible = filterPickerOptions(options, searchable ? query : '');
  const activeIndex = Math.min(active, Math.max(0, visible.length - 1));
  useEffect(() => {
    if (!open) return;
    if (searchable) searchInput.current?.focus();
    const close = () => panel.current?.hidePopover();
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [open, searchable]);
  useEffect(() => {
    if (disabled) panel.current?.hidePopover();
  }, [disabled]);
  function show() {
    const rect = trigger.current!.getBoundingClientRect();
    const above = rect.top > window.innerHeight - rect.bottom;
    const width = Math.min(280, window.innerWidth - 24);
    Object.assign(panel.current!.style, {
      width: `${width}px`,
      left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
      top: above ? 'auto' : `${rect.bottom + 8}px`,
      bottom: above ? `${window.innerHeight - rect.top + 8}px` : 'auto',
      maxHeight: `${Math.max(80, Math.min(340, above ? rect.top - 20 : window.innerHeight - rect.bottom - 20))}px`,
    });
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    panel.current!.showPopover();
    setOpen(true);
    onOpen?.();
  }
  function choose(index: number) {
    if (disabled || !visible[index]) return;
    panel.current!.hidePopover();
    setOpen(false);
    trigger.current!.focus();
    onChange(visible[index].value);
  }
  function move(index: number) {
    if (!visible.length) return;
    const next = (index + visible.length) % visible.length;
    setActive(next);
    panel.current?.querySelectorAll('[role="option"]')[next]?.scrollIntoView({ block: 'nearest' });
  }
  function key(event: KeyboardEvent, fromSearch = false) {
    if (['ArrowDown', 'ArrowUp', ...(!fromSearch ? ['Home', 'End'] : [])].includes(event.key)) {
      event.preventDefault();
      if (!open) show();
      else
        move(
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? visible.length - 1
              : activeIndex + (event.key === 'ArrowDown' ? 1 : -1),
        );
    } else if (open && (event.key === 'Enter' || (!fromSearch && event.key === ' '))) {
      event.preventDefault();
      choose(activeIndex);
    } else if (open && event.key === 'Escape') {
      event.preventDefault();
      panel.current?.hidePopover();
      trigger.current?.focus();
    } else if (event.key === 'Tab') panel.current?.hidePopover();
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={
          open && !searchable && visible.length ? `${id}-${activeIndex}` : undefined
        }
        data-value={value}
        disabled={disabled}
        className={styles.trigger}
        onClick={() => (open ? panel.current!.hidePopover() : show())}
        onKeyDown={(event) => key(event)}
      >
        {selected?.icon}
        <span>{selected?.label ?? fallback ?? value}</span>
        <ChevronDown size={13} className={styles.chevron} />
      </button>
      <div
        ref={panel}
        id={`${id}-panel`}
        popover="auto"
        className={styles.panel}
        onToggle={(event) => setOpen((event.nativeEvent as ToggleEvent).newState === 'open')}
      >
        {searchable && (
          <input
            ref={searchInput}
            className={styles.search}
            role="combobox"
            aria-label={`Search ${label.toLowerCase()} options`}
            aria-controls={`${id}-list`}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-activedescendant={open && visible.length ? `${id}-${activeIndex}` : undefined}
            placeholder={`Search ${label.toLowerCase()}…`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => key(event, true)}
          />
        )}
        <div id={`${id}-list`} role="listbox" aria-label={label}>
          {visible.map((option, index) => (
            <button
              key={option.value}
              id={`${id}-${index}`}
              type="button"
              role="option"
              aria-label={option.label}
              aria-selected={option.value === value}
              tabIndex={-1}
              className={styles.option}
              data-active={index === activeIndex}
              onPointerMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              {option.icon}
              <span className={styles.copy}>
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </span>
              {option.value === value && <Check size={15} className={styles.check} />}
            </button>
          ))}
        </div>
        {!visible.length && (
          <p className={styles.empty} role="status">
            No matching options.
          </p>
        )}
      </div>
    </>
  );
}

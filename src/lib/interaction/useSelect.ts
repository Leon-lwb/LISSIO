import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Select-only combobox: keep DOM focus on the trigger while navigating options. */
export function useSelect({ options, value, disabled, onChange, triggerRef, listRef }: {
  options: readonly SelectOption[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeValue, setActiveValue] = useState(value);
  const search = useRef({ text: '', time: 0 });
  const open = expanded && !disabled && options.some(option => !option.disabled);
  const active = options.find(option => option.value === activeValue && !option.disabled)
    ?? options.find(option => option.value === value && !option.disabled)
    ?? options.find(option => !option.disabled);
  const close = () => { setExpanded(false); search.current.text = ''; };
  const show = () => {
    setActiveValue(value);
    search.current.text = '';
    setExpanded(true);
  };
  const choose = (option: SelectOption | undefined) => {
    if (!option || option.disabled || disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (disabled) setExpanded(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target)
        && !listRef.current?.contains(event.target)) {
        search.current.text = '';
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open, triggerRef, listRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || event.nativeEvent.isComposing) return;
    const available = options.filter(option => !option.disabled);
    if (!available.length) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      if (open) choose(active);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(active);
      else show();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) show();
      const index = available.findIndex(option => option.value === active?.value);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : !open ? Math.max(0, index)
          : Math.min(available.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
      setActiveValue(available[next].value);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const letter = event.key.toLocaleLowerCase();
      const previous = now - search.current.time < 700 ? search.current.text : '';
      const text = previous + letter;
      search.current = { text, time: now };
      const prefix = [...text].every(character => character === letter) ? letter : text;
      const index = available.findIndex(option => option.value === active?.value);
      const start = prefix.length === 1 ? index + 1 : Math.max(0, index);
      const ordered = [...available.slice(start), ...available.slice(0, start)];
      const match = ordered.find(option => option.label.toLocaleLowerCase().startsWith(prefix));
      if (match) {
        setActiveValue(match.value);
        setExpanded(true);
      }
    }
  };

  return { open, active, show, close, choose, setActiveValue, onKeyDown };
}

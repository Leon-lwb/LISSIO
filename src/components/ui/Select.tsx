import { useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useSelect, type SelectOption } from '../../lib/interaction/useSelect';

interface SelectProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/** App-rendered options avoid GTK popup palettes and clipping by dock panels. */
export function Select({ label, value, options, onChange, disabled = false, className = '' }: SelectProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const control = useSelect({ options, value, disabled, onChange, triggerRef, listRef });
  const selected = options.find(option => option.value === value);
  const activeIndex = options.findIndex(option => option.value === control.active?.value);

  useLayoutEffect(() => {
    if (!control.open) return;
    const position = () => {
      const trigger = triggerRef.current;
      const list = listRef.current;
      if (!trigger || !list) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const below = Math.max(0, window.innerHeight - rect.bottom - margin);
      const above = Math.max(0, rect.top - margin);
      const upwards = below < Math.min(list.scrollHeight, 240) && above > below;
      const height = Math.min(320, upwards ? above : below);
      list.style.width = `${Math.min(Math.max(rect.width, 160), window.innerWidth - 2 * margin)}px`;
      list.style.maxHeight = `${height}px`;
      list.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - list.offsetWidth - margin))}px`;
      list.style.top = `${upwards ? Math.max(margin, rect.top - Math.min(list.scrollHeight, height)) : rect.bottom}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    if (triggerRef.current) observer.observe(triggerRef.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [control.open, options]);

  useLayoutEffect(() => {
    if (control.open) document.getElementById(`${id}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [control.open, id, activeIndex]);

  return <>
    <button ref={triggerRef} type="button" role="combobox" aria-label={label}
      aria-haspopup="listbox" aria-expanded={control.open} aria-controls={control.open ? id : undefined}
      aria-activedescendant={control.open && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
      disabled={disabled || !options.some(option => !option.disabled)}
      className={`form-select app-select ${className}`}
      onClick={() => { if (control.open) control.close(); else control.show(); }}
      onKeyDown={control.onKeyDown} onBlur={control.close}>
      <span className="truncate">{selected?.label ?? label}</span>
      <ChevronDown size={13} className="shrink-0 text-text-secondary" aria-hidden="true" />
    </button>
    {control.open && createPortal(
      <div ref={listRef} id={id} role="listbox" aria-label={label} className="app-select-options"
        onPointerDown={event => event.preventDefault()}>
        {options.map((option, index) => <button key={option.value} id={`${id}-${index}`} type="button" tabIndex={-1}
          role="option" aria-selected={option.value === value} disabled={option.disabled} aria-disabled={option.disabled ?? undefined} title={option.label}
          data-active={option.value === control.active?.value}
          className="app-select-option"
          onPointerMove={() => { if (!option.disabled) control.setActiveValue(option.value); }}
          onClick={() => control.choose(option)}>
          <span className="truncate">{option.label}</span>
          {option.value === value && <Check size={13} className="shrink-0" aria-hidden="true" />}
        </button>)}
      </div>, document.body)}
  </>;
}

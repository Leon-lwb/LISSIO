// ============ 属性面板共享表单字段 ============
//
// draft state + blur/Enter 提交 + aria-invalid 红框的统一输入控件。
// 从 WidgetProperties 提取, 供节点属性面板各编辑器复用。

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, InputHTMLAttributes, KeyboardEvent, TextareaHTMLAttributes } from 'react';
import { useTranslation } from '../../i18n';
import { FormField } from './Form';

export function TextField({ value, label, onCommit, allowEmpty = false }: {
  value: string; label: string; onCommit: (value: string) => void;
  allowEmpty?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  const commit = () => {
    const next = draft.trim();
    if (next === '' && !allowEmpty) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(next);
    if (next !== value) onCommit(next);
  };
  return (
    <FormField label={label} error={invalid ? t('requiredValue') : null}>
      <input
        className={`form-input motion-control ${invalid ? 'border-red' : ''}`}
        value={draft}
        onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
        }}
        aria-invalid={invalid}
      />
    </FormField>
  );
}

export function NumberField({ value, label, onCommit, error }: {
  value: number; label: string; onCommit: (value: number) => boolean; error?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(String(value)); setInvalid(false); }, [value]);
  const commit = () => {
    if (draft.trim() === '') {
      setInvalid(true);
      return;
    }
    const parsed = Number(draft);
    const ok = Number.isFinite(parsed) && (parsed === value || onCommit(parsed));
    setInvalid(!ok);
    if (ok) setDraft(String(parsed));
  };
  return (
    <FormField label={label} error={invalid ? error ?? 'Invalid value' : null}>
      <input
        type="number"
        className={`form-input motion-control font-mono ${invalid ? 'border-red' : ''}`}
        value={draft}
        onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
        }}
        aria-invalid={invalid}
      />
    </FormField>
  );
}

/// 可空数字输入 — 空 = null (「自适应」语义, 如节点宽高未显式设置)
export function OptionalNumberField({ value, label, placeholder, onCommit }: {
  value: number | null; label: string; placeholder?: string; onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value == null ? '' : String(value)); setInvalid(false); }, [value]);
  const commit = () => {
    const text = draft.trim();
    if (text === '') {
      setInvalid(false);
      if (value != null) onCommit(null);
      return;
    }
    const parsed = Number(text);
    const ok = Number.isFinite(parsed) && parsed >= 0;
    setInvalid(!ok);
    if (!ok) return;
    const next = Math.round(parsed);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <FormField label={label} flex>
      <input
        type="number"
        className={`form-input motion-control font-mono ${invalid ? 'border-red' : ''}`}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
        }}
        aria-invalid={invalid}
      />
    </FormField>
  );
}

/// 下拉选择 — 受控, 变更即提交 (选项枚举类参数)
export function SelectField({ value, label, options, onChange }: {
  value: string;
  label: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label}>
      <select className="form-select motion-control" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </FormField>
  );
}

// ============ 草稿输入 (输入中不校验不写入, 失焦/回车才提交) ============

/// 数字草稿解析 — 空串/非法/越界返回 null (调用方据此标红并保留草稿)
export function parseDraftNumber(
  draft: string,
  opts: { min?: number; max?: number; integer?: boolean } = {}
): number | null {
  const text = draft.trim();
  if (text === '') return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  if (opts.integer && !Number.isInteger(parsed)) return null;
  if (opts.min != null && parsed < opts.min) return null;
  if (opts.max != null && parsed > opts.max) return null;
  return parsed;
}

interface DraftInputBinding {
  value: string;
  'aria-invalid': boolean;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

/// 草稿输入状态机 — 输入过程只更新草稿; 失焦/回车时调用 commit,
/// 返回 false = 校验失败 (红框 + 草稿保留待修正, 不写入); 聚焦中忽略外部值同步。
function useDraftInput(value: string, commit: (draft: string) => boolean): {
  invalid: boolean;
  binding: DraftInputBinding;
} {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const focusedRef = useRef(false);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(value);
    setInvalid(false);
  }, [value]);

  const doCommit = () => {
    setInvalid(!commitRef.current(draft));
  };

  return {
    invalid,
    binding: {
      value: draft,
      'aria-invalid': invalid,
      onChange: (event) => {
        setDraft(event.target.value);
        setInvalid(false);
      },
      onFocus: () => { focusedRef.current = true; },
      onBlur: () => {
        focusedRef.current = false;
        doCommit();
      },
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          doCommit();
        }
      },
    },
  };
}

type DraftFieldPassthrough<T> = Omit<
  T,
  'value' | 'onChange' | 'onFocus' | 'onBlur' | 'onKeyDown' | 'className' | 'aria-invalid'
>;

/// 裸文本输入 — 失焦/回车提交; 值未变化不写入, 可选 validate 失败标红保留草稿
export function DraftInput({
  value,
  onCommit,
  validate,
  className = 'form-input motion-control',
  invalidClassName = 'border-red',
  ...rest
}: {
  value: string;
  onCommit: (draft: string) => void;
  validate?: (draft: string) => boolean;
  className?: string;
  invalidClassName?: string;
} & DraftFieldPassthrough<InputHTMLAttributes<HTMLInputElement>>) {
  const { invalid, binding } = useDraftInput(value, (draft) => {
    if (draft === value) return true;
    if (validate && !validate(draft)) return false;
    onCommit(draft);
    return true;
  });
  return (
    <input
      {...rest}
      {...binding}
      className={`${className} ${invalid ? invalidClassName : ''}`}
    />
  );
}

/// 裸多行文本 — 仅失焦提交 (回车保留换行语义)
export function DraftTextarea({
  value,
  onCommit,
  className = 'form-input motion-control',
  invalidClassName = 'border-red',
  ...rest
}: {
  value: string;
  onCommit: (draft: string) => void;
  className?: string;
  invalidClassName?: string;
} & DraftFieldPassthrough<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  const { invalid, binding } = useDraftInput(value, (draft) => {
    if (draft === value) return true;
    onCommit(draft);
    return true;
  });
  return (
    <textarea
      {...rest}
      value={binding.value}
      aria-invalid={binding['aria-invalid']}
      onChange={binding.onChange}
      onFocus={binding.onFocus}
      onBlur={binding.onBlur}
      className={`${className} ${invalid ? invalidClassName : ''}`}
    />
  );
}

/// 裸数字输入 — 失焦/回车解析校验 (min/max/integer), 失败红框保留草稿不写入;
/// value 传 null 显示空串 (字段缺省语义)
export function DraftNumberInput({
  value,
  min,
  max,
  integer,
  onCommit,
  className = 'form-input motion-control font-mono',
  invalidClassName = 'border-red',
  ...rest
}: {
  value: number | null;
  min?: number;
  max?: number;
  integer?: boolean;
  onCommit: (value: number) => void;
  className?: string;
  invalidClassName?: string;
} & DraftFieldPassthrough<InputHTMLAttributes<HTMLInputElement>>) {
  const { invalid, binding } = useDraftInput(value == null ? '' : String(value), (draft) => {
    const parsed = parseDraftNumber(draft, { min, max, integer });
    if (parsed == null) return false;
    if (parsed !== value) onCommit(parsed);
    return true;
  });
  return (
    <input
      {...rest}
      {...binding}
      type="number"
      min={min}
      max={max}
      className={`${className} ${invalid ? invalidClassName : ''}`}
    />
  );
}

/// 透明度滑动调节模块 — 滑动条 + 双向百分比数值输入, 拖动/键入即时生效。
/// 值为 0.1-1.0 浮点 (与 settings.appearance 的透明度设置同构),
/// 显示为 10-100 整数百分比。滑动条复用 .slider-input 现成样式, 不另写 CSS。
export function OpacitySliderControl({
  value,
  min,
  max,
  step,
  onCommit,
  label,
  className = '',
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
  label: string;
  className?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const toPct = (v: number) => Math.round(clamp(v) * 100);
  const pct = toPct(value);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="range"
        className="slider-input flex-1 min-w-[80px]"
        min={Math.round(min * 100)}
        max={Math.round(max * 100)}
        step={Math.max(1, Math.round(step * 100))}
        value={pct}
        aria-label={label}
        onChange={(e) => onCommit(clamp(Number(e.target.value) / 100))}
      />
      <div className="flex items-center gap-1 flex-shrink-0">
        <DraftNumberInput
          value={pct}
          min={Math.round(min * 100)}
          max={Math.round(max * 100)}
          integer
          onCommit={(n) => onCommit(clamp(n / 100))}
          className="w-[52px] px-1.5 py-0.5 bg-bg-input text-text-primary border border-border rounded text-xs font-mono text-right focus:outline-none focus:border-accent transition-colors"
          aria-label={label}
        />
        <span className="text-xs text-text-secondary">%</span>
      </div>
    </div>
  );
}

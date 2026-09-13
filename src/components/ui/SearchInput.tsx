// ============ 共享搜索框 ============
//
// 全应用统一的搜索/过滤输入: Search 图标 + 清除按钮 + ESC 清空语义。
// 只负责 UI 外观与交互, 过滤时序由调用方决定 (value 受控上抛)。
// debounceMs > 0 时输入即时回显、停止输入后才上报 onChange — 用于每键触发
// 后端订阅重建的场景 (RawData 搜索直达 Rust 过滤源), 高速打字只上报一次。

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { t } from '../../i18n';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  /// ESC 按下时回调 (清空之后仍会回调, 供调用方重置关联状态如分类跳转)
  onEscape?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /// 输入停止 debounceMs 毫秒后才上报 onChange; 缺省 0 = 每键即时
  debounceMs?: number;
  /// 等宽字体 (hex / ID 过滤)
  mono?: boolean;
  /// sm = 工具栏内联 (RawData 头部); md = 表单高度 h-7 (缺省)
  size?: 'sm' | 'md';
  inputRef?: React.Ref<HTMLInputElement>;
  /// 附加到 wrapper (控制宽度 / 外边距)
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  onEscape,
  autoFocus,
  disabled = false,
  debounceMs = 0,
  mono = false,
  size = 'md',
  inputRef,
  className,
}: SearchInputProps) {
  const lang = useAppStore((s) => s.lang);
  const [display, setDisplay] = useState(value);
  // 最近一次上报给父级的值 — 区分「父级回推 (外部清空/重置)」与「防抖期间尚未上报的本地输入」
  const lastReportedRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value !== lastReportedRef.current) {
      lastReportedRef.current = value;
      setDisplay(value);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    []
  );

  const report = (next: string) => {
    lastReportedRef.current = next;
    onChange(next);
  };

  const cancelPending = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleChange = (next: string) => {
    setDisplay(next);
    if (debounceMs > 0) {
      cancelPending();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        report(next);
      }, debounceMs);
    } else {
      report(next);
    }
  };

  // 清除/ESC 清空不走防抖 — 立即上报, 后端订阅马上回到无过滤状态
  const handleClear = () => {
    cancelPending();
    setDisplay('');
    report('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    if (display !== '') {
      // 有值: 只清空, 不冒泡 (避免同时触发父级 ESC 行为, 如关闭整个弹窗)
      e.stopPropagation();
      handleClear();
    }
    onEscape?.();
  };

  const sizeCls =
    size === 'sm'
      ? 'min-h-[22px] gap-1 rounded px-1.5 py-0.5'
      : 'h-7 gap-1.5 rounded-md px-2';
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <div
      className={`search-box flex items-center bg-bg-input border border-border transition-colors focus-within:border-accent ${
        disabled ? 'opacity-40 pointer-events-none' : ''
      } ${sizeCls} ${className ?? ''}`}
    >
      <Search size={iconSize} className="text-text-secondary shrink-0 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        autoFocus={autoFocus}
        className={`search-input bg-transparent border-none min-w-0 flex-1 text-xs text-text-primary placeholder:text-text-disabled ${mono ? 'font-mono' : ''}`}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        value={display}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {display !== '' && !disabled && (
        <button
          type="button"
          className="shrink-0 flex items-center justify-center text-text-secondary hover:text-text-primary transition-transform duration-150 motion-safe:active:scale-95 cursor-pointer animate-search-clear-in"
          title={t(lang, 'clearSearch')}
          aria-label={t(lang, 'clearSearch')}
          onClick={handleClear}
        >
          <X size={iconSize} />
        </button>
      )}
    </div>
  );
}

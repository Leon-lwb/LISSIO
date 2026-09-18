import { memo, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  SEG_BOLD,
  SEG_DIM,
  SEG_ITALIC,
  SEG_REVERSE,
  SEG_UNDERLINE,
} from '../../../lib/terminal/termColor';
import type { TerminalLine, TerminalSegment } from '../../../lib/terminal/ansiParser';
import type { TerminalBuffer } from '../../../lib/terminal/terminalBuffer';
import { ROW_HEIGHT, formatTime } from './rawDataViewHelpers';

interface Props {
  terminal: TerminalBuffer;
  showTimestamp: boolean;
  parentRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

/// 段样式 → 内联样式。8/16 色走 var(--term-N) 随主题联动, 256/真彩直接色值
function segmentStyle(seg: TerminalSegment): CSSProperties {
  const style: CSSProperties = {};
  const fg = seg.fg;
  const bg = seg.bg;
  if (seg.flags & SEG_REVERSE) {
    // 反显: 前景背景互换; 缺省侧取终端默认色
    const fgColor = fg
      ? (fg.kind === 'ansi' ? `var(--term-${fg.n})` : fg.hex)
      : 'var(--term-fg)';
    if (bg) {
      style.backgroundColor = bg.kind === 'ansi' ? `var(--term-${bg.n})` : bg.hex;
      style.color = fgColor;
    } else {
      style.backgroundColor = fgColor;
      style.color = 'var(--color-bg-editor)';
    }
  } else {
    if (fg) style.color = fg.kind === 'ansi' ? `var(--term-${fg.n})` : fg.hex;
    if (bg) style.backgroundColor = bg.kind === 'ansi' ? `var(--term-${bg.n})` : bg.hex;
  }
  if (seg.flags & SEG_BOLD) style.fontWeight = 600;
  if (seg.flags & SEG_DIM) style.opacity = 0.7;
  if (seg.flags & SEG_ITALIC) style.fontStyle = 'italic';
  if (seg.flags & SEG_UNDERLINE) style.textDecoration = 'underline';
  return style;
}

interface RowProps {
  line: TerminalLine;
  showTimestamp: boolean;
}

/// 终端单行 — 已提交行对象恒定, memo 后只有内容变化才重渲染
const TerminalRow = memo(function TerminalRow({ line, showTimestamp }: RowProps) {
  return (
    <div
      className={`flex items-center px-2 select-text hover:bg-bg-subtle ${line.segments.length === 0 ? '' : 'whitespace-pre'}`}
      style={{ height: ROW_HEIGHT }}
      role="presentation"
    >
      {showTimestamp && (
        <span className="text-accent text-xs font-mono min-w-[92px] text-right mr-2 shrink-0">
          {formatTime(line.ts)}
        </span>
      )}
      <span className="font-mono text-xs">
        {line.segments.map((seg, i) => (
          <span key={i} style={segmentStyle(seg)}>{seg.text}</span>
        ))}
      </span>
    </div>
  );
});

/// 终端视图 — 流式行渲染 (ANSI 彩色 + UTF-8), 虚拟滚动, 行 seq 为稳定 key
export function RawDataViewTerminal({
  terminal,
  showTimestamp,
  parentRef,
  onScroll,
  onKeyDown,
}: Props) {
  const lines = terminal.getLines();
  const openLine = terminal.openLine;
  const lineCount = lines.length + 1;

  const virtualizer = useVirtualizer({
    count: lineCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    // 环形淘汰下 index 会错位, 行 seq (行开始即分配, 提交前后不变) 才是稳定 key
    getItemKey: (index) => (index < lines.length ? lines[index].seq : openLine.seq),
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden font-mono animate-rawdata-enter">
      <div
        className="flex-1 overflow-auto min-h-0 outline-none"
        ref={parentRef}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="listbox"
        aria-label="terminal"
      >
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              minWidth: 'max-content',
              transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
            }}
          >
            {virtualItems.map((virtualRow) => {
              const index = virtualRow.index;
              // 开放行做浅快照 (该行对象会被后续解析原地修改), 保证行 props 不可变语义;
              // 已提交行对象恒定, 直接引用
              const line =
                index < lines.length ? lines[index] : { ...openLine, segments: [...openLine.segments] };
              return (
                <TerminalRow
                  key={virtualRow.key}
                  line={line}
                  showTimestamp={showTimestamp}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

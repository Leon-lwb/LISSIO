import { memo } from 'react';
import { type RawDataLineSource, RAWDATA_BYTES_PER_ROW } from '../../../lib/buffers/dataBuffer';
import { decodeText, isTextEncoding } from '../../../lib/utils/textEncoding';
import { t, type Lang } from '../../../i18n';
import { ROW_HEIGHT, GROUP_SIZE, formatTime, byteToHex, byteToAscii, isPrintable, hexColorClass, directionColorClass, directionSymbol, EscapedText, type HexColorMode, type RawDataGrouping, type RawDataRepr } from './rawDataViewHelpers';

export interface RowProps {
  originalIndex: number;
  filteredIndex: number;
  grouping: RawDataGrouping;
  repr: RawDataRepr;
  buffer: RawDataLineSource;
  showTimestamp: boolean;
  showOffset: boolean;
  hexColorMode: HexColorMode;
  isSelected: boolean;
  version: number;
  lang: Lang;
  onMouseDown: (e: React.MouseEvent, filteredIndex: number) => void;
}

/// cell 尺寸样式 — 模块级共享对象 (React 按 identity 复用, 免去每 cell 新建 + GC)
const CELL_SIZE_HEX = { width: 22, height: ROW_HEIGHT - 4 };
const CELL_SIZE_ASCII = { width: 18, height: ROW_HEIGHT - 4 };

/// cell 类名 — 固定部分预拼接, 颜色类 (小集合) + 组尾缩进按 key 缓存
const CELL_BASE = 'rawdata-cell inline-flex items-center justify-center font-mono text-xs rounded-sm cursor-default transition-colors';
const cellClassCache = new Map<string, string>();

function cellClassName(type: 'hex' | 'ascii', isGroupEnd: boolean, isCompact: boolean, colorClass: string): string {
  const key = `${type}${isGroupEnd ? 1 : 0}${isCompact ? 1 : 0}${colorClass}`;
  let cls = cellClassCache.get(key);
  if (cls === undefined) {
    cls = `${CELL_BASE} ${colorClass}${!isCompact && isGroupEnd ? ' mr-2' : ''}${type === 'ascii' ? ' whitespace-pre' : ''}`;
    if (cellClassCache.size < 256) cellClassCache.set(key, cls);
  }
  return cls;
}

/// 原始数据行 — 从指定 buffer 按索引读取, memo 化避免无关重渲染
/// grouping × repr: grid/line × hex/ascii/utf8/gbk
/// version 用于在底层数据变化时强制刷新可见行
export const Row = memo(function Row({
  originalIndex,
  filteredIndex,
  grouping,
  repr,
  buffer,
  showTimestamp,
  showOffset,
  hexColorMode,
  isSelected,
  lang,
  onMouseDown,
}: RowProps) {
  const isLine = grouping === 'line';
  const line = isLine ? buffer.getNewlineLine(originalIndex) : buffer.getLine(originalIndex);
  // 折行续行: 行首不是 0x0A 之后的新行, 行首用 ↳ 标记 (方向仍在 title 中)
  const continued = isLine && line.continued === true;

  const cellCount = isLine ? line.bytes.length : RAWDATA_BYTES_PER_ROW;
  const byteCount = line.bytes.length;

  const renderCell = (i: number, type: 'hex' | 'ascii') => {
    const present = i < byteCount;
    const isGroupEnd = (i + 1) % GROUP_SIZE === 0 && i !== cellCount - 1;
    if (!present) {
      return (
        <span
          key={i}
          className={cellClassName(type, isGroupEnd, isLine, '')}
          style={type === 'hex' ? CELL_SIZE_HEX : isLine ? undefined : CELL_SIZE_ASCII}
        />
      );
    }
    const b = line.bytes[i];
    const color =
      type === 'hex'
        ? hexColorClass(b, hexColorMode)
        : isPrintable(b)
          ? 'text-green'
          : 'text-text-disabled';
    return (
      <span
        key={i}
        data-present="true"
        className={cellClassName(type, isGroupEnd, isLine, color)}
        style={type === 'hex' ? CELL_SIZE_HEX : isLine ? undefined : CELL_SIZE_ASCII}
      >
        {type === 'hex' ? byteToHex(b) : byteToAscii(b)}
      </span>
    );
  };

  const hexCells: React.ReactNode[] = [];
  const asciiCells: React.ReactNode[] = [];
  if (!isTextEncoding(repr)) {
    for (let i = 0; i < cellCount; i++) {
      if (repr === 'hex') hexCells.push(renderCell(i, 'hex'));
      asciiCells.push(renderCell(i, 'ascii'));
    }
  }

  return (
    <div
      className={`flex items-center gap-2 px-2 select-text ${isSelected ? 'bg-accent/20' : 'hover:bg-bg-hover'}`}
      style={{ height: ROW_HEIGHT }}
      onMouseDown={(e) => onMouseDown(e, filteredIndex)}
      role="presentation"
    >
      <span
        className={`text-xs font-mono min-w-[14px] text-center ${continued ? 'text-text-disabled' : directionColorClass(line.direction)}`}
        title={`${line.direction === 'tx' ? 'TX' : 'RX'}${continued ? ` · ${t(lang, 'rawDataWrappedContinuation')}` : ''}`}
      >
        {continued ? '↳' : directionSymbol(line.direction)}
      </span>
      {showTimestamp && (
        <span className="text-accent text-xs font-mono min-w-[92px] text-right">
          {formatTime(line.timestamp)}
        </span>
      )}
      {showOffset && !isLine && (
        <span className="text-text-secondary text-xs font-mono min-w-[80px] text-right">
          {line.offset.toString(16).padStart(8, '0').toUpperCase()}
        </span>
      )}
      {repr === 'hex' && <div className="flex-1 flex gap-0.5">{hexCells}</div>}
      {isTextEncoding(repr) ? (
        // 整行按所选文本编码解码; 不可见字符渲染为弱化可见符号 (与字符串通道一致)
        <div className="flex-1 min-w-0 whitespace-pre font-mono text-xs">
          <EscapedText text={decodeText(line.bytes, repr)} />
        </div>
      ) : (
        <div className={`flex ${isLine ? '' : 'gap-0.5'} ${repr === 'ascii' ? 'flex-1' : ''}`}>
          {asciiCells}
        </div>
      )}
    </div>
  );
});

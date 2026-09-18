import { memo, useMemo } from 'react';
import { RAWDATA_BYTES_PER_ROW } from '../../../lib/buffers/dataBuffer';
import type { RawDataDirection } from '../../../types';

export type { RawDataDirection };
export type DirectionFilter = 'all' | RawDataDirection;
export type AppendMode = 'none' | 'nl' | 'tab' | 'nl_tab';
export type SendPanelMode = 'bottom' | 'separate';
export type HexColorMode = 'none' | 'printable' | 'range';
/// 行分组方式: grid = 固定 16 字节一行, line = 换行分隔, terminal = 串口终端视图
export type RawDataGrouping = 'grid' | 'line' | 'terminal';
/// 字节表示方式: hex = 十六进制 (+ascii 尾列), ascii = 仅 ascii, utf8 = 整行按 UTF-8 解码的文本
export type RawDataRepr = 'hex' | 'ascii' | 'utf8';

export const ROW_HEIGHT = 22;
export const GROUP_SIZE = 8;

/// 格式化时间戳为 HH:MM:SS.mmm
/// 分片时间戳大量重复 (同 chunk 所有行共用), 缓存避免每行每次渲染 new Date
const TIME_CACHE_CAP = 4096;
const timeCache = new Map<number, string>();

export function formatTime(ts: number): string {
  if (!ts) return '--:--:--.---';
  let cached = timeCache.get(ts);
  if (cached) return cached;
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  cached = `${h}:${m}:${s}.${ms}`;
  if (timeCache.size >= TIME_CACHE_CAP) timeCache.clear();
  timeCache.set(ts, cached);
  return cached;
}

/// 256 项格式化查表 — 热路径 (每行 32 cell × 可见行) 免去 toString/padStart 分配
const HEX_TABLE: string[] = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0').toUpperCase());
const ASCII_TABLE: string[] = Array.from({ length: 256 }, (_, b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.'));

/// 格式化单字节为 2 位大写 hex
export function byteToHex(b: number): string {
  return HEX_TABLE[b] ?? '00';
}

/// 格式化单字节为 ascii（不可打印显示为 .）
export function byteToAscii(b: number): string {
  return ASCII_TABLE[b] ?? '.';
}

/// 判断字节是否为可打印 ASCII
export function isPrintable(b: number): boolean {
  return b >= 32 && b < 127;
}

/// Hex 字节颜色类（根据颜色模式）
export function hexColorClass(b: number, mode: HexColorMode): string {
  if (mode === 'none') return 'text-text-primary';
  if (mode === 'printable') {
    if (b === 0) return 'text-text-disabled';
    return isPrintable(b) ? 'text-text-primary' : 'text-text-secondary';
  }
  // range 模式
  if (b === 0x00) return 'text-text-disabled';
  if (b === 0xff) return 'text-red';
  if (isPrintable(b)) return 'text-blue';
  if (b < 0x20) return 'text-yellow';
  return 'text-text-secondary';
}

/// 方向对应颜色类
export function directionColorClass(direction: RawDataDirection): string {
  return direction === 'tx' ? 'text-blue' : 'text-green';
}

/// 方向对应图标字符
export function directionSymbol(direction: RawDataDirection): string {
  return direction === 'tx' ? '↑' : '↓';
}

// ---- 字符串视图不可见字符转义 (字节网格 ASCII 列仍用 '.' 占位, 两视图刻意不同) ----

/// 不可见字符: C0/C1 控制字符与 DEL (软连字符等零宽符号有意不转义, 避免误伤正常文本)
export function isInvisibleChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

/// 不可见字符 → 单字符宽度可见符号 (⇥ ↵ ␍ / C0 控制图片 ␀…␟ ␡ / 其余 □)
export function escapeControlChar(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  if (code === 0x09) return '⇥';
  if (code === 0x0a) return '↵';
  if (code === 0x0d) return '␍';
  if (code === 0x7f) return '␡';
  if (code < 0x20) return String.fromCharCode(0x2400 + code);
  return '□';
}

export interface EscapedSegment {
  text: string;
  escaped: boolean;
}

/// 把文本切分为 [原样 | 转义符号] 交替段 — 无不可见字符时返回单段原样 (零开销路径)
export function segmentEscapedText(text: string): EscapedSegment[] {
  const segments: EscapedSegment[] = [];
  let plain = '';
  let escaped = '';
  for (const ch of text) {
    if (isInvisibleChar(ch)) {
      if (plain) {
        segments.push({ text: plain, escaped: false });
        plain = '';
      }
      escaped += escapeControlChar(ch);
    } else {
      if (escaped) {
        segments.push({ text: escaped, escaped: true });
        escaped = '';
      }
      plain += ch;
    }
  }
  if (plain) segments.push({ text: plain, escaped: false });
  if (escaped) segments.push({ text: escaped, escaped: true });
  return segments;
}

/// 字符串视图文本 — 不可见字符渲染为弱化的可见转义符号, 各占一个字符位
export const EscapedText = memo(function EscapedText({ text }: { text: string }) {
  const segments = useMemo(() => segmentEscapedText(text), [text]);
  if (segments.length <= 1 && !segments[0]?.escaped) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.escaped ? (
          <span key={index} className="text-text-secondary">{segment.text}</span>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
});

/// 表头：00 01 02 ... 0F
export function HeaderBytes({ width }: { width: number }) {
  return (
    <>
      {Array.from({ length: RAWDATA_BYTES_PER_ROW }, (_, i) => {
        const isGroupEnd = (i + 1) % GROUP_SIZE === 0 && i !== RAWDATA_BYTES_PER_ROW - 1;
        return (
          <span
            key={i}
            className={`inline-flex items-center justify-center text-text-secondary text-xs font-mono ${isGroupEnd ? 'mr-2' : ''}`}
            style={{ width }}
          >
            {byteToHex(i)}
          </span>
        );
      })}
    </>
  );
}

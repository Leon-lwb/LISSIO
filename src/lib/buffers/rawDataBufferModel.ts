import type { RawDataDirection } from '../../types';

export const RAWDATA_BYTES_PER_ROW = 16;

/// 行视图单行字节上限 — 行分组按 0x0A 切分, 但二进制流与非 ASCII 文本 (如无换行的
/// 中文日志) 可能整段没有一个换行符: 此时整段数据会挤进一行, 每字节 2 个 cell,
/// DOM 节点数随接收字节数线性膨胀 (1MB 数据 ≈ 200 万 span)。超限处按此上限自动折行,
/// 折行点回退到 UTF-8 序列起点, 多字节字符不会被截成替换符。
/// 行末的 0x0A 始终留在本行 (不推到下一行), 故单行实际长度上界为该上限 + 1 字节。
export const RAWDATA_LINE_MAX_BYTES = 64;

/// base64 → Uint8Array (atob 一次解码 + 定长拷贝, ~100MB/s 量级)
export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/// 原始数据单行视图
export interface RawDataLineView {
  offset: number;
  timestamp: number;
  direction: RawDataDirection;
  bytes: Uint8Array;
  /// 本行是上一行的折行续行 (行首前一个字节不是 0x0A, 即超过单行上限被折开)。
  /// 仅行分组 (换行模式) 会置位; 复制时续行不插入换行, 保持原始字节序。
  continued?: boolean;
}

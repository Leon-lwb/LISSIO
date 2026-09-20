// ============ 终端缓冲 — 消费 RawDataBuffer 增量字节, 产出彩色终端行 ============
//
// RawDataBuffer (RAF 节流通知) → 增量读取新分片字节 → AnsiStreamParser →
// TerminalLine 环形列表 (上限 TERMINAL_MAX_LINES, 淘汰最旧)。
// 挂接到 React 的 useTerminalLines 与 RawDataBuffer 的订阅节奏一致。

import { useEffect, useMemo, useState } from 'react';
import { AnsiStreamParser, type TerminalLine } from './ansiParser';
import type { RawDataBuffer } from '../buffers/dataBuffer';

/// 终端行数上限 (环形, 淘汰最旧)
export const TERMINAL_MAX_LINES = 5000;

export class TerminalBuffer {
  private parser: AnsiStreamParser;
  private lines: TerminalLine[] = [];
  /// 已消费到的绝对流偏移 (RawDataBuffer 的 writtenTotal 空间)
  private consumedOffset = 0;
  private listeners = new Set<() => void>();

  constructor(ansiDecode: boolean) {
    this.parser = new AnsiStreamParser({
      ansiDecode,
      onLine: (line) => this.pushLine(line),
    });
  }

  /// 从 RawDataBuffer 拉取自上次消费后的新字节 (缓冲通知回调内调用)
  consume(buffer: RawDataBuffer): void {
    // 缓冲被清空或环形回绕覆盖了消费点: 整体重置
    if (buffer.writtenTotal < this.consumedOffset || (buffer.writtenTotal === 0 && this.consumedOffset > 0)) {
      this.reset();
    }
    const baseOffset = buffer.writtenTotal - buffer.storedBytes;
    const start = Math.max(this.consumedOffset, baseOffset);
    if (buffer.writtenTotal > start) {
    const chunks = buffer.getChunkEntries();
    for (const chunk of chunks) {
      const from = Math.max(chunk.offset, start);
      const to = Math.min(chunk.offset + chunk.length, buffer.writtenTotal);
      if (to <= from) continue;
      // 终端只渲染设备流: tx 分片 (本地发送回环) 跳过 — 已发内容由设备回显
      // 呈现; 设备不回显时用"本地回显" (pushLocal)。否则自回显设备 (如登录
      // shell) 每条命令会显示两遍
      if (chunk.direction === 'tx') continue;
      const bytes = buffer.readBytesAt(from, to);
      this.parser.feed(bytes, Math.floor(chunk.timestamp_us / 1000), chunk.direction);
    }
      this.consumedOffset = buffer.writtenTotal;
    }
    // ED2/RIS 清屏: 解析器已清自己的当前行, 这里同步清已提交行
    if (this.parser.screenCleared) {
      this.parser.screenCleared = false;
      if (this.lines.length > 0) {
        this.lines = [];
      }
    }
    this.notify();
  }

  /// 本地回显 — 以 tx 方向走同一解析管线 (换行/转义行为一致)
  pushLocal(text: string, ts: number): void {
    this.parser.feedText(text, ts, 'tx');
    this.notify();
  }

  /// 清空终端视图 (不影响底层 RawDataBuffer 订阅)
  clear(): void {
    this.reset();
    this.notify();
  }

  private reset(): void {
    this.lines = [];
    this.consumedOffset = 0;
    this.parser.reset();
  }

  private pushLine(line: TerminalLine): void {
    this.lines.push(line);
    // 批量淘汰: 超出上限 64 行才 splice 一次, 避免逐行 O(n)
    if (this.lines.length > TERMINAL_MAX_LINES + 64) {
      this.lines.splice(0, this.lines.length - TERMINAL_MAX_LINES);
    }
  }

  /// 已提交行 (不含开放行)
  getLines(): readonly TerminalLine[] {
    return this.lines;
  }

  /// 当前开放行 (渲染为列表最后一行)
  get openLine(): TerminalLine {
    return this.parser.openLine;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }
}

/// 终端行订阅 hook — active=false 时不消费 (字节视图省开销);
/// ansiDecode 变化时重建解析器 (重建后从保留字节全量重放一次)
export function useTerminalLines(buffer: RawDataBuffer, ansiDecode: boolean, active: boolean): {
  terminal: TerminalBuffer;
  version: number;
} {
  const terminal = useMemo(() => new TerminalBuffer(ansiDecode), [ansiDecode]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!active) return;
    terminal.consume(buffer);
    return buffer.subscribe(() => terminal.consume(buffer));
  }, [buffer, terminal, active]);
  useEffect(() => {
    return terminal.subscribe(() => setVersion((v) => v + 1));
  }, [terminal]);
  return { terminal, version };
}

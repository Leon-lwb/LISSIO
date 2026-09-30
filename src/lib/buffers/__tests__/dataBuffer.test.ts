import { describe, expect, it, vi } from 'vitest';
import { RawDataBuffer, RAWDATA_LINE_MAX_BYTES } from '../dataBuffer';
import type { RawDataBatch } from '../../../types';

vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
});

/// 单分片批次 — seq 对行索引无影响, 固定即可; 时间戳用于行时间戳派生
function batch(bytes: readonly number[], direction: 'rx' | 'tx' = 'rx'): RawDataBatch {
  return {
    seq: 0,
    chunks: [{ timestamp_us: 1_000, direction, bytes_b64: btoa(String.fromCharCode(...bytes)) }],
    total_bytes: bytes.length,
    dropped_bytes: 0,
  };
}

/// 按批次推送字节, 返回缓冲
function push(chunks: readonly (readonly number[])[], capacity = 4096): RawDataBuffer {
  const buffer = new RawDataBuffer(capacity);
  for (const chunk of chunks) buffer.pushBatch(batch(chunk));
  return buffer;
}

function rowBytes(buffer: RawDataBuffer, index: number): number[] {
  return Array.from(buffer.getNewlineLine(index).bytes);
}

function rowLengths(buffer: RawDataBuffer): number[] {
  return Array.from({ length: buffer.newlineLineCount }, (_, i) => buffer.getNewlineLine(i).bytes.length);
}

/// 逐字节校验字节序列是否为完整 UTF-8 (无悬空首字节、无孤立续字节)
function isCompleteUtf8(bytes: readonly number[]): boolean {
  let remaining = 0;
  for (const b of bytes) {
    if (remaining > 0) {
      if ((b & 0xc0) !== 0x80) return false;
      remaining--;
      continue;
    }
    if (b < 0x80) continue;
    if ((b & 0xe0) === 0xc0) remaining = 1;
    else if ((b & 0xf0) === 0xe0) remaining = 2;
    else if ((b & 0xf8) === 0xf0) remaining = 3;
    else return false;
  }
  return remaining === 0;
}

describe('RawDataBuffer 行索引 (换行切分)', () => {
  it('splits on 0x0A with the newline kept at the end of the row', () => {
    const buffer = push([[0x41, 0x42, 0x0a, 0x43]]);

    expect(buffer.newlineLineCount).toBe(2);
    expect(rowBytes(buffer, 0)).toEqual([0x41, 0x42, 0x0a]);
    expect(rowBytes(buffer, 1)).toEqual([0x43]);
    expect(buffer.getNewlineLine(0).continued).toBe(false);
    expect(buffer.getNewlineLine(1).continued).toBe(false);
  });

  it('keeps an empty row for a trailing newline (existing semantics)', () => {
    const buffer = push([[0x41, 0x0a]]);

    expect(buffer.newlineLineCount).toBe(2);
    expect(rowBytes(buffer, 1)).toEqual([]);
  });
});

describe('RawDataBuffer 行索引 (超长行自动折行)', () => {
  it('wraps a newline-free byte run at RAWDATA_LINE_MAX_BYTES', () => {
    const buffer = push([Array.from({ length: 200 }, () => 0x41)]);

    expect(buffer.newlineLineCount).toBe(Math.ceil(200 / RAWDATA_LINE_MAX_BYTES));
    expect(rowLengths(buffer)).toEqual([
      RAWDATA_LINE_MAX_BYTES,
      RAWDATA_LINE_MAX_BYTES,
      RAWDATA_LINE_MAX_BYTES,
      200 - RAWDATA_LINE_MAX_BYTES * 3,
    ]);
    // 行起点连续, 无空隙无重叠
    expect([0, 1, 2, 3].map((i) => buffer.getNewlineLine(i).offset)).toEqual([0, 64, 128, 192]);
    // 首行是新行, 其余是折行续行
    expect([0, 1, 2, 3].map((i) => buffer.getNewlineLine(i).continued)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  it('continues the wrap phase when a long run arrives in batches', () => {
    const buffer = new RawDataBuffer(1 << 20);
    for (let i = 0; i < 4; i++) buffer.pushBatch(batch(Array.from({ length: 50 }, () => 0x41)));

    // 200 字节无换行: 跨批次折行相位与一次性推入一致 (0/64/128/192)
    expect(buffer.newlineLineCount).toBe(4);
    expect([0, 1, 2, 3].map((i) => buffer.getNewlineLine(i).offset)).toEqual([0, 64, 128, 192]);
    expect([0, 1, 2, 3].map((i) => buffer.getNewlineLine(i).continued)).toEqual([false, true, true, true]);
  });

  it('produces the same rows when the same bytes arrive in many batches', () => {
    // 每 100 字节一个换行: 折行与换行两种边界都跨批次出现
    const chunk = Array.from({ length: 300 }, (_, i) => (i % 100 === 99 ? 0x0a : 0x41));
    const oneShot = push([chunk]);
    const incremental = push(Array.from({ length: 30 }, (_, i) => chunk.slice(i * 10, i * 10 + 10)));

    expect(incremental.newlineLineCount).toBe(oneShot.newlineLineCount);
    expect(rowLengths(incremental)).toEqual(rowLengths(oneShot));
  });

  it.each([
    // 中文 3 字节/字 (E4 B8 AD): 单行上限 64 不是 3 的倍数, 折行点必然落在序列中间
    { label: '3 字节中文', unit: [0xe4, 0xb8, 0xad], prefix: [] as number[] },
    // 4 字节 emoji (F0 9F 98 80) 前置 1 字节让序列与折行点错位
    { label: '4 字节 emoji', unit: [0xf0, 0x9f, 0x98, 0x80], prefix: [0x41] },
  ])('does not split a multi-byte UTF-8 character at the wrap point ($label)', ({ unit, prefix }) => {
    const chars = 40;
    const bytes = [...prefix, ...Array.from({ length: chars * unit.length }, (_, i) => unit[i % unit.length])];
    const buffer = push([bytes]);

    expect(buffer.newlineLineCount).toBeGreaterThan(1);
    const rows = Array.from({ length: buffer.newlineLineCount }, (_, i) => rowBytes(buffer, i));
    for (const row of rows) {
      expect(row.length).toBeLessThanOrEqual(RAWDATA_LINE_MAX_BYTES);
      // 每行都必须是完整序列 — 被切断的序列会留下悬空的首字节或孤立续字节
      expect(isCompleteUtf8(row)).toBe(true);
    }
    expect(rows.flat()).toEqual(bytes);
  });

  it('keeps rows near the limit for a stream of UTF-8 continuation bytes', () => {
    // 二进制流 (0x80 全是续字节) 不能让折行点无限回退 — 否则会退化成每字节一行
    const total = 4096;
    const buffer = push([Array.from({ length: total }, () => 0x80)]);

    expect(buffer.newlineLineCount).toBeLessThanOrEqual(Math.ceil(total / (RAWDATA_LINE_MAX_BYTES - 3)));
    const lengths = rowLengths(buffer);
    // 末行是流尾余量, 其余每行都应落在 [上限-3, 上限]
    for (const length of lengths.slice(0, -1)) {
      expect(length).toBeGreaterThanOrEqual(RAWDATA_LINE_MAX_BYTES - 3);
      expect(length).toBeLessThanOrEqual(RAWDATA_LINE_MAX_BYTES);
    }
    expect(lengths[lengths.length - 1]).toBe(total % (RAWDATA_LINE_MAX_BYTES - 3));
  });

  it('keeps rows bounded after the ring buffer wraps', () => {
    const buffer = new RawDataBuffer(128);
    buffer.pushBatch(batch(Array.from({ length: 300 }, () => 0x41)));

    expect(buffer.newlineLineCount).toBeGreaterThan(1);
    for (const length of rowLengths(buffer)) {
      expect(length).toBeLessThanOrEqual(RAWDATA_LINE_MAX_BYTES);
    }
    // 环形覆盖后首行是残留的半行, 不标记为续行
    expect(buffer.getNewlineLine(0).continued).toBe(false);
    expect(buffer.getNewlineLine(1).continued).toBe(true);
  });

  it('rebuilds the line index after a capacity change', () => {
    const buffer = push([Array.from({ length: 200 }, () => 0x41)]);
    const before = rowLengths(buffer);

    buffer.setCapacity(8192);

    expect(rowLengths(buffer)).toEqual(before);
    expect(buffer.getNewlineLine(1).continued).toBe(true);
  });

  it('drops the line index on clear', () => {
    const buffer = push([[0x41, 0x0a, 0x42]]);
    expect(buffer.newlineLineCount).toBe(2);

    buffer.clear();

    expect(buffer.newlineLineCount).toBe(0);
    expect(rowBytes(buffer, 0)).toEqual([]);
  });
});

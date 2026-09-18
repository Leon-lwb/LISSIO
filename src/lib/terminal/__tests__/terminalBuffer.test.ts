import { describe, expect, it } from 'vitest';
import { RawDataBuffer } from '../../buffers/dataBuffer';
import type { RawDataBatch } from '../../../types';
import { TERMINAL_MAX_LINES, TerminalBuffer } from '../terminalBuffer';

let batchSeq = 0;

function batchOf(text: string, tsUs = 1_000, direction: 'rx' | 'tx' = 'rx'): RawDataBatch {
  return {
    seq: ++batchSeq,
    chunks: [
      {
        bytes_b64: btoa(text),
        timestamp_us: tsUs,
        direction,
      },
    ],
    total_bytes: text.length,
    dropped_bytes: 0,
  };
}

function linesOf(terminal: TerminalBuffer): string[] {
  const committed = terminal.getLines().map((l) => l.segments.map((s) => s.text).join(''));
  const open = terminal.openLine.segments.map((s) => s.text).join('');
  return open ? [...committed, open] : committed;
}

describe('TerminalBuffer', () => {
  it('消费 RawDataBuffer 增量并按换行出行', () => {
    const buf = new RawDataBuffer(1024);
    const terminal = new TerminalBuffer(true);
    buf.pushBatch(batchOf('hello\nworld\n'));
    terminal.consume(buf);
    expect(linesOf(terminal)).toEqual(['hello', 'world']);
  });

  it('多次增量消费拼接 (UTF-8 跨批)', () => {
    const buf = new RawDataBuffer(1024);
    const terminal = new TerminalBuffer(true);
    const bytes = new TextEncoder().encode('你好\n');
    buf.pushBatch({
      seq: ++batchSeq,
      chunks: [
        { bytes_b64: btoa(String.fromCharCode(...bytes.slice(0, 2))), timestamp_us: 1, direction: 'rx' },
      ],
      total_bytes: 2,
      dropped_bytes: 0,
    });
    terminal.consume(buf);
    buf.pushBatch({
      seq: ++batchSeq,
      chunks: [
        { bytes_b64: btoa(String.fromCharCode(...bytes.slice(2))), timestamp_us: 2, direction: 'rx' },
      ],
      total_bytes: bytes.length - 2,
      dropped_bytes: 0,
    });
    terminal.consume(buf);
    expect(linesOf(terminal)).toEqual(['你好']);
  });

  it('底层 clear 后终端同步重置', () => {
    const buf = new RawDataBuffer(1024);
    const terminal = new TerminalBuffer(true);
    buf.pushBatch(batchOf('a\nb\n'));
    terminal.consume(buf);
    buf.clear();
    terminal.consume(buf);
    expect(linesOf(terminal)).toEqual([]);
  });

  it('环形回绕覆盖消费点后整体重放保留字节', () => {
    const buf = new RawDataBuffer(16);
    const terminal = new TerminalBuffer(true);
    buf.pushBatch(batchOf('0123456789abcdefghij')); // 20 字节 > 16 容量, 仅保留尾部
    terminal.consume(buf);
    expect(linesOf(terminal)).toEqual(['0123456789abcdefghij'.slice(-16)]);
  });

  it('ED2 清屏清空已提交行, 保留后续输出', () => {
    const buf = new RawDataBuffer(1024);
    const terminal = new TerminalBuffer(true);
    buf.pushBatch(batchOf('old\r\x1b[2Jnew'));
    terminal.consume(buf);
    expect(linesOf(terminal)).toEqual(['new']);
  });

  it('行数上限环形淘汰最旧', () => {
    const buf = new RawDataBuffer(1_048_576);
    const terminal = new TerminalBuffer(true);
    const text = Array.from({ length: TERMINAL_MAX_LINES + 200 }, (_, i) => `line${i}\n`).join('');
    buf.pushBatch(batchOf(text));
    terminal.consume(buf);
    const lines = terminal.getLines();
    expect(lines.length).toBeLessThanOrEqual(TERMINAL_MAX_LINES + 64);
    expect(lines[0].segments[0].text).toBe(`line${TERMINAL_MAX_LINES + 200 - lines.length}`);
  });

  it('本地回显以 tx 方向进入终端', () => {
    const buf = new RawDataBuffer(1024);
    const terminal = new TerminalBuffer(true);
    buf.pushBatch(batchOf('ok\n', 5_000));
    terminal.consume(buf);
    terminal.pushLocal('at+ver\n', 6_000);
    const lines = terminal.getLines();
    expect(lines[1].direction).toBe('tx');
    expect(lines[1].ts).toBe(6_000);
  });

  it('行继承所在分片的时间戳', () => {
    const buf = new RawDataBuffer(1024);
    const terminal = new TerminalBuffer(true);
    buf.pushBatch(batchOf('x\n', 1_234_567));
    terminal.consume(buf);
    expect(terminal.getLines()[0].ts).toBe(1234);
  });
});

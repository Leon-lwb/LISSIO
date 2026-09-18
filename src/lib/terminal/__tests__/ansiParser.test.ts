import { describe, expect, it } from 'vitest';
import { AnsiStreamParser, type TerminalLine } from '../ansiParser';
import { SEG_BOLD, SEG_UNDERLINE } from '../termColor';

function parse(input: string, ansiDecode = true): { parser: AnsiStreamParser; lines: TerminalLine[] } {
  const lines: TerminalLine[] = [];
  const parser = new AnsiStreamParser({ ansiDecode, onLine: (l) => lines.push(l) });
  parser.feedText(input, 1000, 'rx');
  return { parser, lines };
}

function text(line: TerminalLine): string {
  return line.segments.map((s) => s.text).join('');
}

describe('AnsiStreamParser 行提交', () => {
  it('按 \\n 提交行, 开放行不计入', () => {
    const { parser, lines } = parse('a\nb\nc');
    expect(lines.map(text)).toEqual(['a', 'b']);
    expect(text(parser.openLine)).toBe('c');
  });

  it('空行也提交', () => {
    const { parser, lines } = parse('a\n\nb\n');
    expect(lines.map(text)).toEqual(['a', '', 'b']);
    expect(text(parser.openLine)).toBe('');
  });

  it('seq 单调递增且提交前后稳定', () => {
    const { parser, lines } = parse('a\nb\nc');
    const openSeq = parser.openLine.seq;
    expect(lines[0].seq).toBe(openSeq - 2);
    expect(lines[1].seq).toBe(openSeq - 1);
  });

  it('行继承 feed 的时间戳与方向', () => {
    const lines: TerminalLine[] = [];
    const parser = new AnsiStreamParser({ ansiDecode: true, onLine: (l) => lines.push(l) });
    parser.feedText('x\n', 1234, 'tx');
    expect(lines[0].ts).toBe(1234);
    expect(lines[0].direction).toBe('tx');
  });
});

describe('AnsiStreamParser UTF-8', () => {
  it('多字节序列跨 feed 断裂可续接', () => {
    const lines: TerminalLine[] = [];
    const parser = new AnsiStreamParser({ ansiDecode: true, onLine: (l) => lines.push(l) });
    const bytes = new TextEncoder().encode('你好\n');
    parser.feed(bytes.slice(0, 2), 1, 'rx'); // 好 的前两个字节落在 "你" 之后
    parser.feed(bytes.slice(2), 2, 'rx');
    expect(lines).toHaveLength(1);
    expect(text(lines[0])).toBe('你好');
  });

  it('非法 UTF-8 字节替换为 U+FFFD', () => {
    const lines: TerminalLine[] = [];
    const p = new AnsiStreamParser({ ansiDecode: true, onLine: (l) => lines.push(l) });
    p.feed(new Uint8Array([0x61, 0xff, 0x62, 0x0a]), 1, 'rx');
    expect(lines.map(text)).toEqual(['a\ufffdb']);
  });
});

describe('AnsiStreamParser SGR 颜色', () => {
  it('基本前景色 + 复位', () => {
    const { parser } = parse('\x1b[31mR\x1b[0mN');
    const segs = parser.openLine.segments;
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ fg: { kind: 'ansi', n: 1 }, bg: null, flags: 0 });
    expect(segs[1]).toMatchObject({ fg: null });
  });

  it('亮色 90-97', () => {
    const { parser } = parse('\x1b[92mg');
    expect(parser.openLine.segments[0].fg).toMatchObject({ kind: 'ansi', n: 10 });
  });

  it('256 色与真彩色', () => {
    const { parser } = parse('\x1b[38;5;196ma\x1b[38;2;12;34;56mb');
    const [a, b] = parser.openLine.segments;
    expect(a.fg).toMatchObject({ kind: 'rgb', hex: '#ff0000' });
    expect(b.fg).toMatchObject({ kind: 'rgb', hex: '#0c2238' });
  });

  it('背景色与样式标志', () => {
    const { parser } = parse('\x1b[1;4;44mz');
    const seg = parser.openLine.segments[0];
    expect(seg.flags & SEG_BOLD).toBeTruthy();
    expect(seg.flags & SEG_UNDERLINE).toBeTruthy();
    expect(seg.bg).toMatchObject({ kind: 'ansi', n: 4 });
  });

  it('22/27 关闭样式', () => {
    const { parser } = parse('\x1b[1;7mA\x1b[22;27mB');
    const [, b] = parser.openLine.segments;
    expect(b.flags).toBe(0);
  });

  it('同色相邻文本合并为单段', () => {
    const { parser } = parse('hello');
    expect(parser.openLine.segments).toHaveLength(1);
  });
});

describe('AnsiStreamParser 控制行为', () => {
  it('\\r 覆盖行首 (进度条)', () => {
    const { parser } = parse('abc\rXY');
    expect(text(parser.openLine)).toBe('XYc');
  });

  it('\\b 退格覆盖', () => {
    const { parser } = parse('abc\b!');
    expect(text(parser.openLine)).toBe('ab!');
  });

  it('\\t 推进到 8 列倍数', () => {
    const { parser } = parse('a\tb');
    expect(text(parser.openLine)).toBe('a       b');
  });

  it('CSI G 定位列 + K 清除光标后内容', () => {
    const { parser } = parse('abcdef\x1b[4G\x1b[K');
    expect(text(parser.openLine)).toBe('abc');
  });

  it('CSI C 光标前移补空格', () => {
    const { parser } = parse('ab\x1b[3CX');
    expect(text(parser.openLine)).toBe('ab   X');
  });

  it('ED 2 置 screenCleared', () => {
    const { parser } = parse('\x1b[2Jx');
    expect(parser.screenCleared).toBe(true);
    expect(text(parser.openLine)).toBe('x');
  });

  it('OSC 序列整体吞噬 (BEL 与 ST 两种终止)', () => {
    const a = parse('\x1b]0;title\x07ok');
    expect(text(a.parser.openLine)).toBe('ok');
    const b = parse('\x1b]2;t\x1b\\ok');
    expect(text(b.parser.openLine)).toBe('ok');
  });

  it('CSI 参数跨 feed 断裂', () => {
    const lines: TerminalLine[] = [];
    const parser = new AnsiStreamParser({ ansiDecode: true, onLine: (l) => lines.push(l) });
    parser.feedText('\x1b[3', 1, 'rx');
    parser.feedText('1mred', 2, 'rx');
    expect(parser.openLine.segments[0].fg).toMatchObject({ kind: 'ansi', n: 1 });
    expect(text(parser.openLine)).toBe('red');
  });

  it('字符集选择序列吞掉', () => {
    const { parser } = parse('\x1b(Bok');
    expect(text(parser.openLine)).toBe('ok');
  });
});

describe('AnsiStreamParser 调试模式', () => {
  it('ansiDecode=false 时序列原文可见', () => {
    const { parser } = parse('\x1b[31mred', false);
    expect(text(parser.openLine)).toBe('[31mred');
  });
});

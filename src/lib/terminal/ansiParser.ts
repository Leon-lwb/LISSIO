// ============ 终端流解析器 — 增量文本解码 + ANSI 转义状态机 ============
//
// 串口字节流 → TerminalLine[] 的纯逻辑层。TextDecoder({stream:true}) 按 UTF-8/GBK
// 跨分片续接多字节序列; 转义状态机的状态跨 feed() 调用保持 (CSI 参数可断在任意字节处)。
// 行模型为流式行终端 (非全网格): \r/\b/CSI G 在当前行内覆写, \n 提交一行。

import type { RawDataDirection } from '../../types';
import { createTextDecoder, type TextEncoding } from '../utils/textEncoding';
import { SgrState, type TermColor } from './termColor';

export interface TerminalSegment {
  text: string;
  /// null = 终端默认前景
  fg: TermColor | null;
  /// null = 透明背景
  bg: TermColor | null;
  flags: number;
}

/// 终端单行 — seq 在行开始时分配, 提交/淘汰后保持稳定 (虚拟列表 key)
export interface TerminalLine {
  seq: number;
  /// 行末字节所在分片的毫秒时间戳
  ts: number;
  direction: RawDataDirection;
  segments: TerminalSegment[];
}

type ParserState = 'ground' | 'escape' | 'charset' | 'csi' | 'osc';

const CSI_PARAM_MIN = 0x30;
const CSI_PARAM_MAX = 0x3f;
const CSI_FINAL_MIN = 0x40;
const CSI_FINAL_MAX = 0x7e;

export interface AnsiParserOptions {
  /// true = 解释转义序列 (彩色渲染); false = 序列原文可见 (调试设备输出)
  ansiDecode: boolean;
  /// 字节流文本编码, 默认 UTF-8
  textEncoding?: TextEncoding;
  /// 一行提交 (收到 \n 或 2J 清屏截断) 时回调
  onLine: (line: TerminalLine) => void;
}

export class AnsiStreamParser {
  private decoder: TextDecoder;
  private readonly textEncoding: TextEncoding;
  private state: ParserState = 'ground';
  private csiParams = '';
  /// OSC 收集中 (等 BEL / ESC\ 终止)
  private oscEsc = false;
  private seq = 0;
  private ts = 0;
  private direction: RawDataDirection = 'rx';
  /// 当前行 (未提交); 行开始即分配 seq, 保证提交前后 key 稳定
  private cur: TerminalLine;
  /// 光标 = 当前行内字符列 (覆盖式写入的落点)
  private cursor = 0;
  private savedCursor = 0;
  /// 当前 SGR 样式状态 (前景/背景/标志)
  private sgr = new SgrState();
  private readonly ansiDecode: boolean;
  private readonly onLine: (line: TerminalLine) => void;
  /// ED 2/3 或 RIS 清屏 — feed 结束后由 TerminalBuffer 读取一次, 借此清空已提交行
  screenCleared = false;

  constructor(opts: AnsiParserOptions) {
    this.textEncoding = opts.textEncoding ?? 'utf8';
    this.decoder = createTextDecoder(this.textEncoding);
    this.ansiDecode = opts.ansiDecode;
    this.onLine = opts.onLine;
    this.cur = this.newLine();
  }

  /// 字节入口 — UTF-8 增量解码后走同一字符解析循环
  feed(bytes: Uint8Array, ts: number, direction: RawDataDirection): void {
    this.beginFeed(ts, direction);
    this.parseChars(this.decoder.decode(bytes, { stream: true }));
  }

  /// 文本入口 (本地回显) — 旁路解码, 转义处理一致
  feedText(text: string, ts: number, direction: RawDataDirection): void {
    this.beginFeed(ts, direction);
    this.parseChars(text);
  }

  /// 开放行的 ts/方向随最近分片推进 (行时间戳 = 最后写入它的分片)
  private beginFeed(ts: number, direction: RawDataDirection): void {
    this.ts = ts;
    this.direction = direction;
    this.cur.ts = ts;
    this.cur.direction = direction;
  }

  /// 清空内部状态 (缓冲 clear 时调用); 未提交行随之丢弃
  reset(): void {
    this.decoder = createTextDecoder(this.textEncoding);
    this.state = 'ground';
    this.csiParams = '';
    this.oscEsc = false;
    this.cursor = 0;
    this.savedCursor = 0;
    this.sgr.reset();
    this.cur = this.newLine();
  }

  /// 当前未提交行 (渲染为列表最后一行)
  get openLine(): TerminalLine {
    return this.cur;
  }

  private newLine(): TerminalLine {
    return { seq: this.seq++, ts: this.ts, direction: this.direction, segments: [] };
  }

  private commitLine(): void {
    this.onLine(this.cur);
    this.cur = this.newLine();
    this.cursor = 0;
  }

  private clearAll(): void {
    this.cur = this.newLine();
    this.cursor = 0;
  }

  private parseChars(text: string): void {
    let plain = '';
    const flushPlain = () => {
      if (plain) {
        this.writeText(plain);
        plain = '';
      }
    };
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      switch (this.state) {
        case 'ground': {
          if (code === 0x1b) {
            flushPlain();
            this.state = 'escape';
          } else if (code === 0x0a) {
            flushPlain();
            this.commitLine();
          } else if (code === 0x0d) {
            flushPlain();
            this.cursor = 0;
          } else if (code === 0x08) {
            flushPlain();
            this.cursor = Math.max(0, this.cursor - 1);
          } else if (code === 0x09) {
            flushPlain();
            const next = (Math.floor(this.cursor / 8) + 1) * 8;
            if (next >= this.lineLength()) {
              this.writeText(' '.repeat(next - this.lineLength()));
            }
            this.cursor = next;
          } else if (code === 0x0c || code === 0x0b) {
            // VT/FF 按换行处理 (串口设备常当行分隔)
            flushPlain();
            this.commitLine();
          } else if (code < 0x20 || code === 0x7f) {
            // NUL/SO/SI 等其余控制字符忽略
          } else {
            plain += ch;
          }
          break;
        }
        case 'escape': {
          if (code === 0x5b) {
            // '[' → CSI
            this.csiParams = '';
            this.state = 'csi';
          } else if (code === 0x5d) {
            // ']' → OSC (吞到 BEL 或 ESC \)
            this.oscEsc = false;
            this.state = 'osc';
          } else if (code === 0x28 || code === 0x29) {
            // 字符集选择 (ESC ( B 等): 无显示效果, 转入 charset 态吞掉终止符
            this.state = 'charset';
          } else if (code === 0x1b) {
            // 连续 ESC: 重新进入 escape
            this.state = 'escape';
          } else if (code === 0x63 && this.ansiDecode) {
            // ESC c = RIS 全复位
            this.sgr.reset();
            this.clearAll();
            this.screenCleared = true;
            this.state = 'ground';
          } else {
            // 其余单字符转义 (ESC 7/8/D/M/>) 忽略
            this.state = 'ground';
          }
          break;
        }
        case 'csi': {
          if (code >= CSI_PARAM_MIN && code <= CSI_PARAM_MAX) {
            this.csiParams += ch;
          } else if (code >= 0x20 && code < CSI_PARAM_MIN) {
            // 中间字节 (空格到 /): 串口日志中罕见, 无需保存, 略过即可
          } else if (code >= CSI_FINAL_MIN && code <= CSI_FINAL_MAX) {
            this.dispatchCsi(ch);
            this.state = 'ground';
          } else if (code === 0x1b) {
            // 序列中途 ESC: 放弃当前 CSI, 重新开始
            this.state = 'escape';
          } else {
            this.state = 'ground';
          }
          break;
        }
        case 'charset': {
          // 序列终止符: ESC 重启转义, 其余字符吞掉后回 ground
          this.state = code === 0x1b ? 'escape' : 'ground';
          break;
        }
        case 'osc': {
          if (code === 0x07) {
            this.state = 'ground';
          } else if (this.oscEsc) {
            // ESC \ = ST
            this.oscEsc = false;
            this.state = 'ground';
          } else if (code === 0x1b) {
            this.oscEsc = true;
          }
          break;
        }
      }
    }
    flushPlain();
  }

  private lineLength(): number {
    let len = 0;
    for (const seg of this.cur.segments) len += seg.text.length;
    return len;
  }

  /// 以默认样式复用末段, 减少小块段数量
  private lastSeg(): TerminalSegment | undefined {
    return this.cur.segments[this.cur.segments.length - 1];
  }

  private sameStyle(a: TerminalSegment | undefined): boolean {
    return !!a && a.fg === this.sgr.fg && a.bg === this.sgr.bg && a.flags === this.sgr.flags;
  }

  private writeText(text: string): void {
    const len = this.lineLength();
    if (this.cursor >= len) {
      if (this.cursor > len) {
        // 光标被 C[n] 推出行尾: 先补空格
        this.appendSeg(' '.repeat(this.cursor - len));
      }
      this.appendSeg(text);
      this.cursor += text.length;
      return;
    }
    this.overwriteAt(text);
  }

  private appendSeg(text: string): void {
    const last = this.lastSeg();
    if (this.sameStyle(last) && last) {
      last.text += text;
    } else {
      this.cur.segments.push({ text, fg: this.sgr.fg, bg: this.sgr.bg, flags: this.sgr.flags });
    }
  }

  /// 覆盖式写入 (\r 进度条/表格重绘): 从光标列起替换 len(text) 个字符
  private overwriteAt(text: string): void {
    const cur = this.cur;
    // 定位光标所在段
    let idx = 0;
    let pos = 0;
    while (idx < cur.segments.length && pos + cur.segments[idx].text.length <= this.cursor) {
      pos += cur.segments[idx].text.length;
      idx++;
    }
    const segs = cur.segments.slice(0, idx);
    if (pos < this.cursor && idx < cur.segments.length) {
      const head = cur.segments[idx];
      segs.push({ ...head, text: head.text.slice(0, this.cursor - pos) });
    }
    segs.push({ text, fg: this.sgr.fg, bg: this.sgr.bg, flags: this.sgr.flags });
    // 消费被覆盖的旧字符: 首段先跳过光标之前的部分
    let remain = text.length;
    let skip = this.cursor - pos;
    while (remain > 0 && idx < cur.segments.length) {
      const seg = cur.segments[idx];
      const avail = seg.text.length - skip;
      if (avail > remain) {
        segs.push({ ...seg, text: seg.text.slice(skip + remain) });
        remain = 0;
      } else {
        remain -= avail;
      }
      skip = 0;
      idx++;
    }
    while (idx < cur.segments.length) {
      segs.push(cur.segments[idx]);
      idx++;
    }
    // 与前段样式相同则合并, 避免覆写路径反复碎段
    if (segs.length >= 2 && this.segsSameStyle(segs[segs.length - 2], segs[segs.length - 1])) {
      const tail = segs.pop()!;
      segs[segs.length - 1].text += tail.text;
    }
    cur.segments = segs;
    this.cursor += text.length;
  }

  private segsSameStyle(a: TerminalSegment, b: TerminalSegment): boolean {
    return a.fg === b.fg && a.bg === b.bg && a.flags === b.flags;
  }

  // ---- CSI 分发 ----

  private csiNum(index: number, fallback: number): number {
    const raw = this.csiParams;
    let start = 0;
    let i = 0;
    let field = 0;
    while (i <= raw.length) {
      if (i === raw.length || raw[i] === ';' || raw[i] === ':') {
        if (field === index) {
          const token = raw.slice(start, i);
          const n = parseInt(token, 10);
          return Number.isFinite(n) ? n : fallback;
        }
        field++;
        start = i + 1;
      }
      i++;
    }
    return fallback;
  }

  private dispatchCsi(final: string): void {
    if (!this.ansiDecode) {
      // 调试模式: 序列原文可见 (ESC 本身以符号位呈现由上层控制字符策略决定, 此处仅去掉 ESC)
      this.writeText(`[${this.csiParams}${final}`);
      return;
    }
    if (final === 'm') {
      // SGR — 参数机在 termColor.SgrState
      const raw = this.csiParams;
      // 拆平 ';' 与 ':' 两种分隔 (38:5:196 与 38;5;196 等价处理)
      const nums: number[] = [];
      for (const token of raw.split(/[;:]/)) {
        if (token === '') nums.push(0);
        else {
          const n = parseInt(token, 10);
          nums.push(Number.isFinite(n) ? n : 0);
        }
      }
      this.sgr.applyParams(nums);
      return;
    }
    switch (final) {
      case 'J': {
        const mode = this.csiNum(0, 0);
        if (mode === 0) {
          this.eraseFromCursor();
        } else if (mode === 1) {
          // ED 1 的已提交行部分无法回撤 (流式模型), 退化为清当前行; 光标保持
          this.cur.segments = [];
        } else {
          // 2/3 = 清屏: 清空已提交行由 TerminalBuffer 监听 onClear 完成, 这里清当前行
          this.cur.segments = [];
          this.screenCleared = true;
        }
        break;
      }
      case 'K': {
        const mode = this.csiNum(0, 0);
        if (mode === 0) this.eraseFromCursor();
        else if (mode === 1 || mode === 2) {
          // 行首清空; 光标保持 (流式行终端无"上方"已提交行可回撤)
          this.cur.segments = [];
        }
        break;
      }
      case 'C': {
        this.cursor += Math.max(1, this.csiNum(0, 1));
        break;
      }
      case 'D': {
        this.cursor = Math.max(0, this.cursor - this.csiNum(0, 1));
        break;
      }
      case 'G': {
        this.cursor = Math.max(0, this.csiNum(0, 1) - 1);
        break;
      }
      case 'H':
      case 'f': {
        this.cursor = Math.max(0, this.csiNum(1, 1) - 1);
        break;
      }
      case 's': {
        this.savedCursor = this.cursor;
        break;
      }
      case 'u': {
        this.cursor = this.savedCursor;
        break;
      }
      default:
        break;
    }
  }

  /// 光标到行尾清空 (EL 0 / ED 0 的行内部分)
  private eraseFromCursor(): void {
    const cur = this.cur;
    let pos = 0;
    let idx = 0;
    while (idx < cur.segments.length && pos + cur.segments[idx].text.length <= this.cursor) {
      pos += cur.segments[idx].text.length;
      idx++;
    }
    const kept = cur.segments.slice(0, idx);
    if (pos < this.cursor && idx < cur.segments.length) {
      const head = cur.segments[idx];
      kept.push({ ...head, text: head.text.slice(0, this.cursor - pos) });
    }
    cur.segments = kept;
  }
}

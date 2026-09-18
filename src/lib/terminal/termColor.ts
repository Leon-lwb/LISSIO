// ============ 终端颜色与 SGR 状态 — ANSI 颜色表 + 样式参数机 ============
//
// 从 ansiParser 拆出: 16/256/真彩色解析与 SGR 参数到样式标志的应用。
// 颜色对象全部缓存复用 — 段合并依赖对象相等性判定。

/// 段样式标志位
export const SEG_BOLD = 1;
export const SEG_DIM = 2;
export const SEG_ITALIC = 4;
export const SEG_UNDERLINE = 8;
export const SEG_REVERSE = 16;

/// 颜色: ansi = 0-15 基本色 (渲染层映射 var(--term-N)); rgb = 直接色值
export type TermColor = { kind: 'ansi'; n: number } | { kind: 'rgb'; hex: string };

/// xterm 256 色表: 0-15 → null (用 --term-N 变量), 16-255 → '#rrggbb'
const PALETTE_256: (null | string)[] = (() => {
  const table: (null | string)[] = new Array<null | string>(256).fill(null);
  const steps = [0, 95, 135, 175, 215, 255];
  let i = 16;
  for (const r of steps) {
    for (const g of steps) {
      for (const b of steps) {
        table[i++] = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
      }
    }
  }
  for (let gray = 0; gray < 24; gray++) {
    const v = gray * 10 + 8;
    const hex = `#${((v << 16) | (v << 8) | v).toString(16).padStart(6, '0')}`;
    table[i++] = hex;
  }
  return table;
})();

/// 基本色对象缓存 (同色 SGR 反复合并段时靠对象相等性判定)
const ANSI_COLORS: TermColor[] = Array.from({ length: 16 }, (_, n) => ({ kind: 'ansi' as const, n }));
const RGB_CACHE = new Map<string, TermColor>();

function rgbColor(hex: string): TermColor {
  let c = RGB_CACHE.get(hex);
  if (!c) {
    c = { kind: 'rgb', hex };
    RGB_CACHE.set(hex, c);
  }
  return c;
}

function color256(n: number): TermColor {
  const hex = PALETTE_256[n & 0xff];
  return hex ? rgbColor(hex) : ANSI_COLORS[n % 16];
}

/// 当前 SGR 样式状态 — 解析器持有, 文本段创建时快照 fg/bg/flags
export class SgrState {
  fg: TermColor | null = null;
  bg: TermColor | null = null;
  flags = 0;

  reset(): void {
    this.fg = null;
    this.bg = null;
    this.flags = 0;
  }

  /// 应用一组 SGR 参数 (CSI ... m, ';' 与 ':' 分隔已拆平)
  applyParams(nums: number[]): void {
    let i = 0;
    while (i < nums.length) {
      const n = nums[i];
      switch (n) {
        case 0:
          this.reset();
          break;
        case 1:
          this.flags |= SEG_BOLD;
          break;
        case 2:
          this.flags |= SEG_DIM;
          break;
        case 3:
          this.flags |= SEG_ITALIC;
          break;
        case 4:
          this.flags |= SEG_UNDERLINE;
          break;
        case 7:
          this.flags |= SEG_REVERSE;
          break;
        case 21:
        case 22:
          this.flags &= ~(SEG_BOLD | SEG_DIM);
          break;
        case 23:
          this.flags &= ~SEG_ITALIC;
          break;
        case 24:
          this.flags &= ~SEG_UNDERLINE;
          break;
        case 27:
          this.flags &= ~SEG_REVERSE;
          break;
        case 39:
          this.fg = null;
          break;
        case 49:
          this.bg = null;
          break;
        case 38:
        case 48: {
          const color = this.parseExtended(nums, i + 1);
          i = color.next;
          if (n === 38) this.fg = color.color;
          else this.bg = color.color;
          continue;
        }
        default: {
          if (n >= 30 && n <= 37) this.fg = ANSI_COLORS[n - 30];
          else if (n >= 90 && n <= 97) this.fg = ANSI_COLORS[n - 90 + 8];
          else if (n >= 40 && n <= 47) this.bg = ANSI_COLORS[n - 40];
          else if (n >= 100 && n <= 107) this.bg = ANSI_COLORS[n - 100 + 8];
          break;
        }
      }
      i++;
    }
  }

  /// 38/48 扩展色: 5;n (256 色) 或 2;r;g;b (真彩); 返回消费到的下标
  private parseExtended(nums: number[], start: number): { color: TermColor | null; next: number } {
    const mode = nums[start];
    if (mode === 5) {
      return { color: color256(nums[start + 1] ?? 0), next: start + 2 };
    }
    if (mode === 2) {
      const r = nums[start + 1] ?? 0;
      const g = nums[start + 2] ?? 0;
      const b = nums[start + 3] ?? 0;
      const hex = `#${((r & 0xff) << 16 | (g & 0xff) << 8 | (b & 0xff)).toString(16).padStart(6, '0')}`;
      return { color: rgbColor(hex), next: start + 4 };
    }
    // 未知子模式: 只消费模式字节
    return { color: null, next: start + 1 };
  }
}

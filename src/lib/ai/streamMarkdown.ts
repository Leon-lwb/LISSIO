//! 流式 Markdown 的稳定切分。
//!
//! 流式渲染的成本集中在「每来一个 token 就把整段已生成文本重新解析一遍」:
//! 单 token O(长度) → 整段 O(n²)。会话越长、回复越长, 主线程越早被拖满,
//! 最终表现为渲染进程被系统回收 (白屏后自动重载)。
//!
//! 这里把已生成文本切成 `frozen` (最后一个稳定块边界之前的全部内容) 与
//! `active` (边界之后的活跃尾块): 边界不动时 `frozen` 取值不变, 交给 memo 化
//! 渲染器后整段重解析退化成「只重解析尾块」。
//!
//! 边界取「围栏代码块之外的空白行之后」——块级 Markdown 在空白行处切分与整段
//! 解析语义一致; 表格不可能含空白行, 所以这种边界天然不会把表格截断。
//! 只有活跃尾块异常长 (单段落没有空白行) 时才退一步用行尾边界, 并对缩进续行 /
//! 表格行 / setext 下划线等「依赖上一行」的行首做排除。

/// 活跃尾块的目标上限; 超过它才启用行尾边界这一退路。
const MAX_ACTIVE_CHARS = 1200;

export interface StreamMarkdownSplit {
  /// 已完成前缀 — 边界不动时保持不变, 可以交给 memo 化的渲染器。
  frozen: string;
  /// 活跃尾块 — 每个 token 都会变, 只有它需要重解析。
  active: string;
}

interface Scan {
  /// 最后一个「围栏外、空白行之后」的偏移 (块级安全边界)。
  blank: number;
  /// 最后一个「围栏外、可安全起新块」的行尾偏移 (退路边界)。
  soft: number;
  /// 围栏代码块区间 `[start, end)`, 用于判断任意偏移是否落在代码块内。
  fences: [number, number][];
}

/// 围栏行 — 行首以 ``` 或 ~~~ 开头 (行内反引号不算)。
function isFence(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

/// 行首是否依赖上一行 — 缩进续行 / 表格行 / setext 下划线。
function dependsOnPrevious(line: string): boolean {
  if (line.length === 0) return false;
  if (/^\s/.test(line)) return true;
  if (line.startsWith('|')) return true;
  return /^[=-]{2,}\s*$/.test(line);
}

/// 扫描一遍文本: 记录安全边界与围栏区间。
function scan(text: string): Scan {
  const result: Scan = { blank: 0, soft: 0, fences: [] };
  const lines = text.split('\n');
  let offset = 0;
  let fenceStart: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineEnd = Math.min(text.length, offset + line.length);
    const nextLine = lines[index + 1];
    if (isFence(line)) {
      if (fenceStart === null) {
        fenceStart = offset;
      } else {
        result.fences.push([fenceStart, offset + line.length]);
        fenceStart = null;
      }
    } else if (fenceStart === null) {
      // 空白行之后 — 块级安全边界 (行内空格视为空白)
      if (line.trim().length === 0) {
        result.blank = Math.min(text.length, lineEnd + 1);
      } else if (nextLine !== undefined && nextLine.trim().length > 0 && !dependsOnPrevious(nextLine)) {
        // 行尾退路 — 只在下一行能独立起块时可用
        result.soft = lineEnd + 1;
      }
    }
    offset = lineEnd + 1;
  }
  if (fenceStart !== null) result.fences.push([fenceStart, text.length]);
  return result;
}

/// 偏移是否落在未闭合/已闭合的围栏代码块内。
function insideFence(fences: [number, number][], position: number): boolean {
  return fences.some(([start, end]) => position > start && position < end);
}

/// 把流式文本切成 `frozen` + `active`。
///
/// 文本还没有任何安全边界时返回 `{ frozen: '', active: text }` —— 调用方
/// 退化为整段解析, 与切分前的行为一致。
export function splitStreamingMarkdown(text: string): StreamMarkdownSplit {
  if (text.length <= MAX_ACTIVE_CHARS) return { frozen: '', active: text };
  const { blank, soft, fences } = scan(text);
  let cut = blank;
  if (text.length - cut > MAX_ACTIVE_CHARS && soft > cut) {
    cut = insideFence(fences, soft) ? cut : soft;
  }
  if (text.length - cut > MAX_ACTIVE_CHARS) {
    // 最后退路: 单个超长段落没有可用的行边界 — 在空格处硬切, 只影响视觉换行
    const probe = text.length - MAX_ACTIVE_CHARS;
    const space = text.lastIndexOf(' ', probe);
    if (space > cut && !insideFence(fences, space)) cut = space + 1;
  }
  if (cut <= 0) return { frozen: '', active: text };
  return { frozen: text.slice(0, cut), active: text.slice(cut) };
}

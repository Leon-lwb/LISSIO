//! AI 会话 → Markdown 序列化 (标准对话格式)
//!
//! 供聊天面板"导出会话为 .md"使用:
//! 文件头 (会话名 + 导出时间) + 按「## 用户 / ## 助手」分节,
//! 助手条目附带工具调用摘要行, 错误条目渲染为引用块警告。
//! 文案随界面语言 (t), 纯函数便于测试。

import { t, type Lang } from '../../i18n';
import { formatAiKindError } from './aiErrors';
import type { AiViewItem } from '../../types';

/// 工具名缩短展示 (去掉 mcp_ 前缀与 server 段) — 与聊天面板气泡一致
export function shortToolName(name: string): string {
  return name.replace(/^mcp_[^_]+_/, '');
}

/// 时间戳 → `YYYY-MM-DD HH:mm` (本地时区)
function formatTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/// 工具调用摘要行 — `- 🔧 \`name\` 状态`
function toolLines(item: AiViewItem, lang: Lang): string[] {
  if (!item.tools?.length) return [];
  return item.tools.map((run) => {
    const status = !run.done ? t(lang, 'aiToolRunning') : run.is_error ? t(lang, 'aiToolFailed') : t(lang, 'aiToolDone');
    return `- 🔧 \`${shortToolName(run.name)}\` ${status}`;
  });
}

/// 附件块 — 以标注标题 + 代码围栏呈现 (完整存档, 保留原文内容)
function attachmentLines(item: AiViewItem, lang: Lang): string[] {
  if (!item.attachments?.length) return [];
  const title = t(lang, 'aiChatExportAttachment');
  const lines: string[] = [];
  for (const att of item.attachments) {
    lines.push(`**${title}: \`${att.name}\`**`, '', '```', att.content, '```', '');
  }
  return lines;
}

/// 单条消息 → `## 角色` + 正文 (+ 附件 / 工具摘要 / 错误警告)
function itemLines(item: AiViewItem, lang: Lang): string[] {
  const roleKey = item.role === 'user' ? 'aiChatExportUser' : 'aiChatExportAssistant';
  const lines = ['', `## ${t(lang, roleKey)}`, ''];
  if (item.error) {
    // 错误条目: 按 kind 本地化为主行, 后端原始描述为次要行 (与气泡展示一致)
    const view = formatAiKindError(item.error_kind ?? '', item.error_data, item.text, lang);
    lines.push(`> ⚠️ ${view.summary}`);
    if (view.detail) lines.push(`> ${view.detail}`);
    return lines;
  }
  const body = item.text.trim();
  if (body) lines.push(body);
  const attachments = attachmentLines(item, lang);
  if (attachments.length > 0) {
    if (body) lines.push('');
    lines.push(...attachments);
  }
  const tools = toolLines(item, lang);
  if (tools.length > 0) {
    if (body || attachments.length > 0) lines.push('');
    lines.push(...tools);
  }
  return lines;
}

/// 将会话条目序列化为 Markdown 文本
export function sessionToMarkdown(
  title: string,
  items: AiViewItem[],
  lang: Lang,
  now: Date = new Date()
): string {
  const lines = [
    `# ${title}`,
    '',
    `> ${t(lang, 'aiChatExportMeta').replace('{time}', formatTimestamp(now))}`,
    ...items.flatMap((item) => itemLines(item, lang)),
  ];
  return `${lines.join('\n')}\n`;
}

/// 导出文件名 (不含扩展名) — 会话名去掉路径非法字符 + 分钟级时间戳, 如 `lissio-ai-调试记录-20260912-1430`
export function sessionFilename(title: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `lissio-ai-${safe || 'chat'}-${stamp}`;
}

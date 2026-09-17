//! AI 对话附件读取 (系统文件对话框 + 拖放)
//!
//! 仅支持文本类文件: 内容随 `ai_chat_send` 传给后端, 派生历史时并入 user
//! 消息文本。对话框经平台 shim (`src/lib/platform/`) 走 dialog / fs (桌面 = Tauri
//! 插件, 浏览器 = `<input type="file">`); 拖放走 HTML5 dataTransfer + FileReader
//! (主窗口已禁用原生 drag-drop 劫持)。两条路径共用同一组校验规则 (类型 / 大小 /
//! 数量)。

import { platform } from '../platform';
import type { AiAttachment } from '../../types';

/// 单附件内容上限 (字符数, 约 256KB 文本)
export const MAX_ATTACHMENT_CHARS = 256 * 1024;
/// 单条消息附件数上限
export const MAX_ATTACHMENTS = 5;

/** 支持的文本扩展名白名单 (无扩展名不放行, 避免误读二进制) */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml',
  'ini', 'cfg', 'conf', 'log', 'xml', 'html', 'htm', 'css', 'scss',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'svelte',
  'py', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs',
  'rb', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'r', 'lua', 'dart',
]);

/** 按原因分组的拒绝名单 (供调用方本地化提示) */
export interface AttachmentRejections {
  unsupported: string[];
  tooLarge: string[];
  tooMany: string[];
  readFailed: string[];
}

/** 一次添加附件的结果 (成功 + 被拒名单) */
export interface AttachmentPickResult {
  attachments: AiAttachment[];
  rejections: AttachmentRejections;
}

/** 候选文件 — 名称 + 字节大小 (对话框路径拿不到大小, 传 NaN 跳过预检) */
interface Candidate {
  name: string;
  size: number;
}

/** 按类型 / 大小 / 数量上限筛选候选; 与已有附件同名的静默跳过。 */
export function filterAttachmentCandidates(
  candidates: Candidate[],
  existing: AiAttachment[]
): { accepted: Candidate[]; rejections: AttachmentRejections } {
  const rejections: AttachmentRejections = {
    unsupported: [],
    tooLarge: [],
    tooMany: [],
    readFailed: [],
  };
  const existingNames = new Set(existing.map((a) => a.name));
  const accepted: Candidate[] = [];
  for (const c of candidates) {
    const ext = c.name.includes('.') ? (c.name.split('.').pop() ?? '').toLowerCase() : '';
    if (!ext || !TEXT_EXTENSIONS.has(ext)) {
      rejections.unsupported.push(c.name);
    } else if (existingNames.has(c.name)) {
      // 已附加的同名文件直接忽略
    } else if (Number.isFinite(c.size) && c.size > MAX_ATTACHMENT_CHARS) {
      rejections.tooLarge.push(c.name);
    } else if (existing.length + accepted.length >= MAX_ATTACHMENTS) {
      rejections.tooMany.push(c.name);
    } else {
      accepted.push(c);
    }
  }
  return { accepted, rejections };
}

/** 从路径提取文件名 (兼容 / 与 \ 分隔符) */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** FileReader 读取文本 (Blob.text() 在旧 WKWebView 不可用) */
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

/** 读取通过校验的单个文件内容; 空文件静默跳过, 失败计入 readFailed。 */
async function readCandidate(
  name: string,
  read: () => Promise<string>,
  rejections: AttachmentRejections
): Promise<AiAttachment | null> {
  let content: string;
  try {
    content = await read();
  } catch {
    rejections.readFailed.push(name);
    return null;
  }
  if (!content) return null;
  if (content.length > MAX_ATTACHMENT_CHARS) {
    rejections.tooLarge.push(name);
    return null;
  }
  return { name, content };
}

/** 系统文件对话框选择文本文件 (可多选)。用户取消返回 null。 */
export async function pickAttachments(existing: AiAttachment[]): Promise<AttachmentPickResult | null> {
  const selected = await platform.openFile({
    multiple: true,
    directory: false,
    filters: [
      { name: 'Text', extensions: [...TEXT_EXTENSIONS] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (!selected) return null;
  const paths = (Array.isArray(selected) ? selected : [selected]).filter(
    (p): p is string => typeof p === 'string' && p !== ''
  );
  const { accepted, rejections } = filterAttachmentCandidates(
    paths.map((p) => ({ name: baseName(p), size: Number.NaN })),
    existing
  );
  const attachments: AiAttachment[] = [];
  for (const { name } of accepted) {
    const path = paths.find((p) => baseName(p) === name);
    if (!path) {
      rejections.readFailed.push(name);
      continue;
    }
    const att = await readCandidate(name, () => platform.readTextFile(path), rejections);
    if (att) attachments.push(att);
  }
  return { attachments, rejections };
}

/** 读取拖放到输入区的文本文件 (HTML5 File, 无需路径权限)。 */
export async function readDroppedFiles(
  files: FileList | File[],
  existing: AiAttachment[]
): Promise<AttachmentPickResult> {
  const list = Array.from(files);
  const { accepted, rejections } = filterAttachmentCandidates(
    list.map((f) => ({ name: f.name, size: f.size })),
    existing
  );
  const byName = new Map(list.map((f) => [f.name, f]));
  const picked = await Promise.all(
    accepted.map(({ name }) => {
      const file = byName.get(name);
      const read = file
        ? () => readAsText(file)
        : () => Promise.reject(new Error('missing file'));
      return readCandidate(name, read, rejections);
    })
  );
  return {
    attachments: picked.filter((a): a is AiAttachment => a !== null),
    rejections,
  };
}

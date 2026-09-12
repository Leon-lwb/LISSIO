//! Markdown 文件导入 / 导出 (系统文件对话框)
//!
//! 供 AI 会话导出与系统提示词编辑器共用:
//! - 导出: "另存为" 对话框 + 写文本文件
//! - 导入: "打开" 对话框 + 读文本文件
//! 复用全局 dialog / fs 插件 (capabilities 已授权任意路径文本读写), 无需后端命令。

import { save, open } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

const MD_FILTERS = [{ name: 'Markdown', extensions: ['md'] }];

/// 保存结果 — 区分用户取消与写入失败, 便于调用方决定是否提示
export type MdSaveResult = 'ok' | 'cancelled' | 'error';

/** 通过系统"另存为"对话框将 Markdown 文本写入文件 (自动补 .md 扩展名)。 */
export async function saveMdFile(filename: string, text: string): Promise<MdSaveResult> {
  try {
    const path = await save({
      defaultPath: `${filename}.md`,
      filters: MD_FILTERS,
    });
    // 用户取消 — save 返回 null (或 undefined)
    if (!path) return 'cancelled';
    await writeTextFile(path, text);
    return 'ok';
  } catch (e) {
    console.warn('[mdFile] 保存 Markdown 文件失败:', e);
    return 'error';
  }
}

/** 通过系统"打开"对话框读取 Markdown 文本。
 *  用户取消返回 null, 读取失败抛出错误 (由调用方决定提示方式)。 */
export async function readMdFile(): Promise<string | null> {
  const selected: unknown = await open({
    multiple: false,
    directory: false,
    filters: MD_FILTERS,
  });
  if (!selected) return null;
  const path: unknown = Array.isArray(selected) ? (selected as unknown[])[0] : selected;
  if (typeof path !== 'string' || path === '') return null;
  return await readTextFile(path);
}

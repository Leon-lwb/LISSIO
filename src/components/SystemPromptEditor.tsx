//! 系统提示词编辑器弹窗
//!
//! - Markdown 源码多行编辑 + 实时预览 (复用 AiMarkdown)
//! - 支持导入 / 导出 .md 文件 (系统文件对话框)
//! - 本地草稿编辑, 保存时经回调写回设置 (settings.ai.systemPrompt)

import { useEffect, useState } from 'react';
import { Download, FileText, Upload, X } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { t } from '../i18n';
import { readMdFile, saveMdFile } from '../lib/tauri/mdFile';
import { notify, formatError } from '../lib/tauri/notifications';
import { activateOnKeyboard } from '../lib/utils/a11y';
import { AiMarkdown } from './ai/AiMarkdown';

interface SystemPromptEditorProps {
  isOpen: boolean;
  /** 打开时的初始提示词 (设置中的当前值) */
  initialText: string;
  onClose: () => void;
  onSave: (text: string) => void;
}

export function SystemPromptEditor({ isOpen, initialText, onClose, onSave }: SystemPromptEditorProps) {
  const lang = useAppStore((s) => s.lang);
  const [draft, setDraft] = useState(initialText);

  // 每次打开时同步设置中的最新值 (上次保存后可能已被导入备份等途径修改)
  useEffect(() => {
    if (isOpen) setDraft(initialText);
  }, [isOpen, initialText]);

  if (!isOpen) return null;

  const onImport = async () => {
    try {
      const text = await readMdFile();
      if (text == null) return; // 用户取消
      if (!text.trim()) {
        notify.warn(t(lang, 'promptEditorImportFailed'), t(lang, 'promptEditorImportEmpty'), {
          source: 'prompt-editor',
        });
        return;
      }
      setDraft(text);
    } catch (e) {
      notify.error(t(lang, 'promptEditorImportFailed'), formatError(e), { source: 'prompt-editor' });
    }
  };

  const onExport = async () => {
    const result = await saveMdFile('system-prompt', draft);
    if (result === 'ok') {
      notify.info(t(lang, 'promptEditorExportSuccess'), t(lang, 'promptEditorExportSuccessDesc'), {
        source: 'prompt-editor',
      });
    } else if (result === 'error') {
      notify.error(t(lang, 'promptEditorExportFailed'), t(lang, 'aiChatExportFailedDesc'), {
        source: 'prompt-editor',
      });
    }
    // 用户取消不提示
  };

  return (
    <div
      className="fixed inset-0 bg-bg-overlay z-[9100] flex items-center justify-center animate-[settings-fade-in_0.15s_ease-out]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={activateOnKeyboard}
      role="button"
      tabIndex={0}
    >
      <div
        className="w-[880px] max-w-[92vw] h-[640px] max-h-[88vh] bg-bg-sidebar border border-border rounded-lg shadow-modal flex flex-col overflow-hidden animate-[settings-slide-in_0.2s_ease-out]"
        role="dialog"
        aria-modal="true"
      >
        {/* 顶部 — 标题 + 关闭 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-panel-header flex-shrink-0">
          <FileText size={15} className="text-accent" />
          <span className="text-sm font-semibold text-text-bright">{t(lang, 'promptEditorTitle')}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={() => void onImport()}
              title={t(lang, 'promptEditorImport')}
            >
              <Upload size={12} />
              <span>{t(lang, 'promptEditorImport')}</span>
            </button>
            <button
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={() => void onExport()}
              title={t(lang, 'promptEditorExport')}
            >
              <Download size={12} />
              <span>{t(lang, 'promptEditorExport')}</span>
            </button>
            <button
              className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={onClose}
              title={t(lang, 'aiClose')}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 主体 — 左源码编辑 / 右实时预览 */}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0 flex flex-col border-r border-border">
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-text-secondary border-b border-border-subtle flex-shrink-0">
              {t(lang, 'promptEditorSource')}
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="flex-1 min-h-0 w-full resize-none bg-bg-editor px-3 py-2 text-xs font-mono text-text-primary outline-none"
              placeholder={t(lang, 'settingAiSystemPromptDesc')}
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-text-secondary border-b border-border-subtle flex-shrink-0">
              {t(lang, 'promptEditorPreview')}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
              {draft.trim() ? (
                <AiMarkdown text={draft} />
              ) : (
                <div className="text-xs text-text-secondary">{t(lang, 'aiPlaceholder')}</div>
              )}
            </div>
          </div>
        </div>

        {/* 底部 — 字符数 + 取消 / 保存 */}
        <div className="flex items-center gap-3 px-4 py-3 border-t border-border bg-bg-panel-header flex-shrink-0">
          <span className="text-xs text-text-secondary">{t(lang, 'promptEditorChars').replace('{n}', String(draft.length))}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded text-xs text-text-secondary border border-border hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
              onClick={onClose}
            >
              {t(lang, 'cancel')}
            </button>
            <button
              className="px-3 py-1.5 rounded text-xs bg-accent text-accent-foreground hover:opacity-90 transition-opacity cursor-pointer"
              onClick={() => {
                onSave(draft);
                onClose();
              }}
            >
              {t(lang, 'promptEditorSave')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

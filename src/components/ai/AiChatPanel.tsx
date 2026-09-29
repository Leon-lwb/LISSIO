import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eraser,
  FileText,
  Pencil,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAiChatStore } from '../../store/aiChatStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useSettingsStore } from '../../store/settingsStore';
import { dockDrag } from '../../lib/dockDrag';
import { formatAiKindError } from '../../lib/ai/aiErrors';
import { sessionFilename, sessionToMarkdown } from '../../lib/ai/chatMarkdown';
import { readMdFile, saveMdFile } from '../../lib/tauri/mdFile';
import {
  pickAttachments,
  readDroppedFiles,
  type AttachmentPickResult,
  type AttachmentRejections,
} from '../../lib/tauri/attachments';
import { checkAiProviderSettings } from '../../settings/aiProvider';
import { notify, formatError } from '../../lib/tauri/notifications';
import { t } from '../../i18n';
import { activateOnKeyboard } from '../../lib/utils/a11y';
import { AiTurnTimeline } from './AiTurnTimeline';
import type { AiAttachment, AiViewItem } from '../../types';

/// 助手消息气泡 — Markdown 渲染 + 悬停操作 (复制 / 错误重试)
function AssistantBubble({ item, canRetry }: { item: AiViewItem; canRetry: boolean }) {
  const lang = useAppStore((s) => s.lang);
  const regenerate = useAiChatStore((s) => s.regenerate);
  const [copied, setCopied] = useState(false);
  const hasText = item.text.length > 0;
  // 错误条目: 按 kind 本地化为主行, 后端原始描述降级为次要信息 (排查用)
  const errView = item.error
    ? formatAiKindError(item.error_kind ?? '', item.error_data, item.text, lang)
    : null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  return (
    <div className="flex justify-start group animate-ai-msg-in ai-assistant-message">
      <div
        className={`max-w-full min-w-0 w-full px-1 py-1 space-y-2 ${
          item.error ? 'text-danger' : ''
        }`}
      >
        {errView ? (
          <>
            <div className="break-words">{errView.summary}</div>
            {errView.detail && (
              <div className="break-all opacity-70 line-clamp-3">{errView.detail}</div>
            )}
          </>
        ) : <AiTurnTimeline text={item.text} reasoning={item.reasoning} tools={item.tools} timeline={item.timeline} durationMs={item.duration_ms} />}
        {/* 悬停操作条 — 复制原文 / 错误条目重试 (仅最后一条可重试, 与后端 truncate 语义一致) */}
        <div
          className={`flex items-center gap-0.5 -mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
            item.error ? 'justify-end' : ''
          }`}
        >
          {hasText && (
            <button
              className="p-0.5 rounded text-text-secondary hover:text-text-primary"
              onClick={() => void onCopy()}
              title={t(lang, 'aiCopy')}
            >
              {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
            </button>
          )}
          {item.error && canRetry && (
            <button
              className="p-0.5 rounded text-text-secondary hover:text-text-primary disabled:opacity-40"
              onClick={() => void regenerate()}
              disabled={!canRetry}
              title={t(lang, 'aiRetry')}
            >
              <RotateCcw size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/// 会话下拉 — 列表 (最近活动优先) / 新建 / 行内重命名 / 删除
function SessionMenu() {
  const lang = useAppStore((s) => s.lang);
  const { sessions, activeSessionId, createSession, switchSession, renameSession, deleteSession } =
    useAiChatStore();
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const sorted = useMemo(() => [...sessions].sort((a, b) => b.updated_at - a.updated_at), [sessions]);
  const activeTitle = sessions.find((s) => s.id === activeSessionId)?.title ?? t(lang, 'aiSessionNew');

  const commitRename = async () => {
    if (renamingId && draft.trim()) await renameSession(renamingId, draft.trim());
    setRenamingId(null);
  };

  const onDelete = async (id: string) => {
    await deleteSession(id);
    // 删空后自动补一个默认会话, 面板保持可用
    if (useAiChatStore.getState().sessions.length === 0) {
      await createSession(t(lang, 'aiSessionNew'));
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <button
        className="flex w-full min-w-0 items-center gap-1 px-1.5 h-5 rounded text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
        onClick={() => setOpen((v) => !v)}
        title={`${t(lang, 'aiSessionSwitch')}: ${activeTitle}`}
      >
        <span className="truncate">{activeTitle}</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={t(lang, 'aiSessionSwitch')}
            className="fixed inset-0 z-20 border-0 bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-6 z-30 w-56 max-w-[80vw] rounded-lg border border-border-subtle bg-bg-panel-header shadow-lg py-1 flex flex-col animate-ai-menu-in">
            <div className="max-h-56 overflow-y-auto">
              {sorted.length === 0 && (
                <div className="px-2 py-1.5 text-[11px] text-text-secondary">{t(lang, 'aiSessionEmpty')}</div>
              )}
              {sorted.map((s) => (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1 px-2 py-1 text-xs hover:bg-bg-hover cursor-pointer ${
                    s.id === activeSessionId ? 'text-accent' : 'text-text-primary'
                  }`}
                  onClick={() => {
                    if (s.id !== activeSessionId) void switchSession(s.id);
                    setOpen(false);
                  }}
                  onKeyDown={activateOnKeyboard}
                  role="button"
                  tabIndex={0}
                >
                  {renamingId === s.id ? (
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commitRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => void commitRename()}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-bg-input rounded px-1 outline-none focus:ring-1 ring-accent"
                    />
                  ) : (
                    <>
                      <span className="flex-1 min-w-0 truncate">{s.title}</span>
                      <button
                        className="p-0.5 rounded text-text-secondary opacity-0 group-hover:opacity-100 hover:text-text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(s.id);
                          setDraft(s.title);
                        }}
                        title={t(lang, 'aiSessionRename')}
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        className="p-0.5 rounded text-text-secondary opacity-0 group-hover:opacity-100 hover:text-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDelete(s.id);
                        }}
                        title={t(lang, 'aiSessionDelete')}
                      >
                        <Trash2 size={10} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <button
              className="w-full flex items-center gap-1 px-2 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary border-t border-border-subtle"
              onClick={() => {
                void createSession(t(lang, 'aiSessionNew'));
                setOpen(false);
              }}
            >
              <Plus size={11} />
              {t(lang, 'aiSessionNew')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/// AI 对话面板 — 可停靠 (右/左/下/浮动), 流式对话 + Markdown 渲染 +
/// 多会话 (后端持有) + MCP 工具调用展示
export function AiChatPanel() {
  const lang = useAppStore((s) => s.lang);
  const {
    viewItems,
    streaming,
    streamingSessionId,
    activeSessionId,
    streamingText,
    reasoningText,
    timeline,
    toolRuns,
    send,
    cancel,
    clearSession,
    createSession,
    refreshSessions,
    refreshTools,
    refreshServerStatus,
    startLocalServer,
  } = useAiChatStore();
  const setAiPanelVisible = useLayoutStore((s) => s.setAiPanelVisible);
  const draggingAiPanel = useLayoutStore((s) => s.draggingAiPanel);
  const openSettings = useSettingsStore((s) => s.open);
  const aiSettings = useSettingsStore((s) => s.settings.ai);
  // 发送前检查: 配置缺失时输入区上方常驻横幅并禁用发送
  const sendIssue = useMemo(() => checkAiProviderSettings(aiSettings), [aiSettings]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerComposing = useRef(false);
  const composerCompositionEndedAt = useRef<number | null>(null);
  const pinnedBottom = useRef(true);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  // 打开面板: 拉取会话/工具/状态, 并按需自启本地 MCP server (opt-in 语义);
  // 首次使用 (无任何会话) 时自动建一个默认会话
  useEffect(() => {
    void refreshServerStatus();
    void refreshTools();
    if (!useAiChatStore.getState().serverRunning) {
      void startLocalServer();
    }
    void (async () => {
      await refreshSessions();
      if (useAiChatStore.getState().sessions.length === 0) {
        await createSession(t(useAppStore.getState().lang, 'aiSessionNew'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 用户未上滚时自动跟随最新消息
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (pinnedBottom.current) el.scrollTop = el.scrollHeight;
    setShowScrollToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 48);
  }, [viewItems, streamingText, reasoningText, timeline, toolRuns]);

  const onSend = (message = input) => {
    const text = message.trim();
    if ((!text && attachments.length === 0) || streaming || !activeSessionId || sendIssue) return;
    setInput('');
    const atts = attachments;
    setAttachments([]);
    void send(text, atts);
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (composerComposing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;

    event.preventDefault();
    // Some IMEs emit the confirming Enter after compositionend with isComposing=false.
    const endedAt = composerCompositionEndedAt.current;
    if (endedAt !== null && event.timeStamp >= endedAt && event.timeStamp - endedAt < 100) return;
    onSend();
  };

  // 附件被拒提示 — 按原因分组聚合为逐条通知
  const notifyRejections = (rejections: AttachmentRejections) => {
    const groups: [keyof AttachmentRejections, string][] = [
      ['unsupported', 'aiAttachmentUnsupported'],
      ['tooLarge', 'aiAttachmentTooLarge'],
      ['tooMany', 'aiAttachmentTooMany'],
      ['readFailed', 'aiAttachmentReadFailed'],
    ];
    const sep = lang === 'zh' ? '、' : ', ';
    for (const [key, i18nKey] of groups) {
      const names = rejections[key];
      if (names.length > 0) {
        notify.warn(t(lang, 'aiAttach'), t(lang, i18nKey).replace('{n}', names.join(sep)), {
          source: 'ai-attach',
        });
      }
    }
  };

  // 合并一次添加结果 (对话框 / 拖放共用)
  const mergePicked = (result: AttachmentPickResult | null) => {
    if (!result) return; // 用户取消
    if (result.attachments.length > 0) {
      setAttachments((prev) => [...prev, ...result.attachments]);
    }
    notifyRejections(result.rejections);
  };

  const onPickAttachments = async () => {
    try {
      mergePicked(await pickAttachments(attachments));
    } catch (e) {
      notify.error(t(lang, 'aiAttach'), formatError(e), { source: 'ai-attach' });
    }
  };

  const onDropFiles = async (files: FileList) => {
    try {
      mergePicked(await readDroppedFiles(files, attachments));
    } catch (e) {
      notify.error(t(lang, 'aiAttach'), formatError(e), { source: 'ai-attach' });
    }
  };

  // 导出当前会话为 Markdown 文件 (标准对话格式)
  const onExportChat = async () => {
    if (!activeSessionId || viewItems.length === 0) return;
    const title =
      useAiChatStore.getState().sessions.find((s) => s.id === activeSessionId)?.title ??
      t(lang, 'aiSessionNew');
    const result = await saveMdFile(sessionFilename(title), sessionToMarkdown(title, viewItems, lang));
    if (result === 'ok') {
      notify.info(t(lang, 'aiChatExportSuccess'), t(lang, 'aiChatExportSuccessDesc'), { source: 'ai-export' });
    } else if (result === 'error') {
      notify.error(t(lang, 'aiChatExportFailed'), t(lang, 'aiChatExportFailedDesc'), { source: 'ai-export' });
    }
    // 用户取消不提示
  };

  // 导入 Markdown 文件内容到输入框 (可编辑后再手动发送)
  const onImportChat = async () => {
    try {
      const text = await readMdFile();
      if (text == null) return; // 用户取消
      if (!text.trim()) {
        notify.warn(t(lang, 'aiChatImportFailed'), t(lang, 'aiChatImportEmpty'), { source: 'ai-import' });
        return;
      }
      setInput(text);
    } catch (e) {
      notify.error(t(lang, 'aiChatImportFailed'), formatError(e), { source: 'ai-import' });
    }
  };

  // 流式气泡只在发起它的会话内显示 (切走再切回仍可见)
  const showStreaming = streaming && streamingSessionId === activeSessionId;

  return (
    <div
      data-tour="ai-chat"
      className={`relative h-full flex flex-col overflow-hidden ${
        draggingAiPanel ? 'ring-2 ring-inset ring-accent' : ''
      }`}
    >
      {/* 标题栏 — 同时作为拖拽把手 (拖到窗口边缘停靠, 松手空白处浮动) */}
      <div
        className="flex items-center gap-1.5 px-2 h-8 border-b border-border-subtle shrink-0 select-none cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest('button, input')) return;
          dockDrag.begin(e, { kind: 'ai-panel', label: t(lang, 'aiChat') });
        }}
      >
        <Bot size={13} className="text-accent shrink-0" />
        <SessionMenu />
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            className="p-1 rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
            onClick={() => void onImportChat()}
            disabled={streaming}
            title={t(lang, 'aiImportChat')}
          >
            <Upload size={12} />
          </button>
          <button
            className="p-1 rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
            onClick={() => void onExportChat()}
            disabled={streaming || viewItems.length === 0}
            title={t(lang, 'aiExportChat')}
          >
            <Download size={12} />
          </button>
          <button
            className="p-1 rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
            onClick={() => void clearSession()}
            disabled={streaming || viewItems.length === 0}
            title={t(lang, 'aiClear')}
          >
            <Eraser size={12} />
          </button>
          <button
            className="p-1 rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            onClick={() => setAiPanelVisible(false)}
            title={t(lang, 'aiClose')}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={listRef}
          className={`h-full overflow-x-hidden overflow-y-auto px-3 py-3 space-y-2 text-xs ${showScrollToBottom ? 'ai-chat-scroll-fade' : ''}`}
          onScroll={(e) => {
            const el = e.currentTarget;
            const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
            pinnedBottom.current = distance < 32;
            setShowScrollToBottom(distance > 48);
          }}
        >
          {viewItems.length === 0 && !showStreaming && (
            <div className="h-full flex items-center justify-center text-text-secondary">{t(lang, 'aiPlaceholder')}</div>
          )}
          {viewItems.map((item, i) =>
            item.role === 'user' ? (
              <div key={i} className="flex justify-end animate-ai-msg-in">
                <div className="max-w-[88%] rounded-2xl px-3 py-2 bg-bg-hover text-text-primary space-y-1.5">
                  {item.attachments && item.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.attachments.map((att, j) => (
                        <span
                          key={j}
                          title={att.name}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/15 text-[11px] max-w-[180px]"
                        >
                          <FileText size={10} className="shrink-0" />
                          <span className="truncate">{att.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {item.text && <div className="whitespace-pre-wrap break-words">{item.text}</div>}
                </div>
              </div>
            ) : (
              <AssistantBubble key={i} item={item} canRetry={!!item.error && i === viewItems.length - 1 && !streaming} />
            )
          )}

          {/* 流式中的回合 */}
          {showStreaming && (
            <div className="flex justify-start animate-ai-msg-in">
              <div className="w-full min-w-0 px-1 py-1 space-y-2 ai-assistant-message">
                <AiTurnTimeline text={streamingText} reasoning={reasoningText} tools={toolRuns} timeline={timeline} streaming />
              </div>
            </div>
          )}
        </div>
        {showScrollToBottom && (
          <button
            type="button"
            className="absolute bottom-2 left-1/2 z-10 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-border-subtle bg-bg-panel-header text-text-primary shadow-lg transition-colors hover:bg-bg-hover"
            onClick={() => {
              pinnedBottom.current = true;
              const list = listRef.current;
              if (list) {
                list.scrollTo({
                  top: list.scrollHeight,
                  behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                });
              }
            }}
            title={t(lang, 'aiScrollToBottom')}
            aria-label={t(lang, 'aiScrollToBottom')}
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>

      {/* 发送前检查未通过 — 内联横幅 (点击直达设置) */}
      {sendIssue && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border-subtle bg-warning/10 text-warning text-[11px] shrink-0 animate-ai-banner-in">
          <AlertCircle size={11} className="shrink-0" />
          <span className="flex-1 min-w-0 truncate">
            {t(lang, 'aiSendBlocked')}
            {formatAiKindError(sendIssue.kind, sendIssue.params, '', lang).summary}
          </span>
          <button
            className="px-1.5 py-0.5 rounded bg-warning/15 hover:bg-warning/25 shrink-0"
            onClick={() => openSettings('ai')}
          >
            {t(lang, 'aiOpenSettings')}
          </button>
        </div>
      )}

      {/* 输入区 — 支持拖放文本文件作为附件 (拖入时高亮) */}
      <div
        className={`shrink-0 bg-bg-editor/90 backdrop-blur-md ${dragOver ? 'ring-1 ring-inset ring-accent' : ''}`}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          if (!streaming && e.dataTransfer.files.length > 0) void onDropFiles(e.dataTransfer.files);
        }}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pt-2">
            {attachments.map((att, i) => (
              <span
                key={`${att.name}-${i}`}
                className="flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 rounded bg-bg-hover text-[11px] max-w-[200px]"
              >
                <FileText size={10} className="text-accent shrink-0" />
                <span className="truncate" title={att.name}>
                  {att.name}
                </span>
                <button
                  className="p-0.5 rounded text-text-secondary hover:text-text-primary shrink-0"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  title={t(lang, 'aiRemoveAttachment')}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="px-3 py-3">
          <div className="w-full min-w-0 rounded-2xl border border-border-subtle bg-bg-input p-2.5 text-text-primary transition-colors duration-fast focus-within:border-accent">
            <textarea
              ref={composerRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onCompositionStart={() => {
                composerComposing.current = true;
                composerCompositionEndedAt.current = null;
              }}
              onCompositionEnd={(event) => {
                composerComposing.current = false;
                composerCompositionEndedAt.current = event.timeStamp;
              }}
              onKeyDown={onComposerKeyDown}
              placeholder={t(lang, 'inputMessage')}
              aria-label={t(lang, 'inputMessage')}
              rows={1}
              className="ai-composer-textarea block w-full min-w-0 max-h-32 resize-none overflow-y-auto border-0 bg-transparent px-1.5 pt-1 pb-2 text-xs leading-5 text-text-primary placeholder:text-text-secondary outline-none"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-full text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
                onClick={() => void onPickAttachments()}
                disabled={streaming}
                title={t(lang, 'aiAttach')}
                aria-label={t(lang, 'aiAttach')}
              >
                <Plus size={19} />
              </button>
              <button
                type="button"
                className={`grid size-8 shrink-0 place-items-center rounded-full text-text-inverse transition-colors disabled:opacity-40 ${streaming ? 'bg-danger hover:bg-bg-danger-hover' : 'bg-accent hover:bg-accent-hover'}`}
                onClick={streaming ? () => void cancel() : () => onSend()}
                disabled={!streaming && ((!input.trim() && attachments.length === 0) || !activeSessionId || !!sendIssue)}
                title={t(lang, streaming ? 'aiStop' : 'aiSend')}
                aria-label={t(lang, streaming ? 'aiStop' : 'aiSend')}
              >
                {streaming ? <Square size={13} fill="currentColor" /> : <ArrowUp size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

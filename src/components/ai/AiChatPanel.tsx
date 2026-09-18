import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eraser,
  FileText,
  Paperclip,
  Pencil,
  Plug,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Upload,
  Wrench,
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
import { AiMarkdown } from './AiMarkdown';
import type { AiAttachment, AiToolRun, AiViewItem } from '../../types';

/// 工具名缩短展示 (去掉 mcp_ 前缀与 server 段)
function shortToolName(name: string): string {
  return name.replace(/^mcp_[^_]+_/, '');
}

/// 工具调用卡片 (运行中 / 完成 / 失败)
function ToolRunCard({ run }: { run: AiToolRun }) {
  const lang = useAppStore((s) => s.lang);
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`rounded border text-[11px] ${
        run.is_error
          ? 'border-danger/40 bg-danger/10'
          : run.done
            ? 'border-border-subtle bg-bg-hover/40'
            : 'border-accent/40 bg-accent/10'
      }`}
    >
      <button
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Wrench
          size={11}
          className={`shrink-0 text-text-secondary ${!run.done ? 'animate-pulse' : ''}`}
        />
        <span className="font-medium truncate">{shortToolName(run.name)}</span>
        <span className="ml-auto text-text-secondary shrink-0">
          {!run.done ? t(lang, 'aiToolRunning') : run.is_error ? t(lang, 'aiToolFailed') : t(lang, 'aiToolDone')}
        </span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-2 pb-1.5 space-y-1 border-t border-border-subtle pt-1.5 animate-ai-tool-expand">
          <pre className="whitespace-pre-wrap break-all text-text-secondary max-h-24 overflow-y-auto">
            {JSON.stringify(run.arguments, null, 2)}
          </pre>
          {run.content && (
            <pre className="whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{run.content}</pre>
          )}
        </div>
      )}
    </div>
  );
}

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
    <div className="flex justify-start group animate-ai-msg-in">
      <div
        className={`max-w-[92%] rounded-lg px-2.5 py-1.5 space-y-1.5 ${
          item.error ? 'bg-danger/10 text-danger border border-danger/30' : 'bg-bg-hover'
        }`}
      >
        {item.tools && item.tools.length > 0 && (
          <div className="space-y-1">
            {item.tools.map((run) => (
              <ToolRunCard key={run.id} run={run} />
            ))}
          </div>
        )}
        {errView ? (
          <>
            <div className="break-words">{errView.summary}</div>
            {errView.detail && (
              <div className="break-all opacity-70 line-clamp-3">{errView.detail}</div>
            )}
          </>
        ) : (
          hasText && <AiMarkdown text={item.text} />
        )}
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
    <div className="relative min-w-0">
      <button
        className="flex items-center gap-1 px-1.5 h-5 rounded text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary min-w-0"
        onClick={() => setOpen((v) => !v)}
        title={t(lang, 'aiSessionSwitch')}
      >
        <span className="max-w-[140px] truncate">{activeTitle}</span>
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

/// 外部 MCP server 管理抽屉
function McpDrawer({ onClose }: { onClose: () => void }) {
  const lang = useAppStore((s) => s.lang);
  const { servers, tools, addServer, removeServer, setServerEnabled, refreshTools } = useAiChatStore();
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<'stdio' | 'http'>('stdio');

  const canAdd =
    name.trim().length > 0 &&
    (kind === 'stdio' ? command.trim().length > 0 : url.startsWith('http://') || url.startsWith('https://'));

  const onAdd = async () => {
    await addServer({
      id: `srv-${Date.now().toString(36)}`,
      name: name.trim(),
      transport:
        kind === 'stdio'
          ? { kind: 'stdio', command: command.trim(), args: command.trim().split(/\s+/).slice(1), env: {} }
          : { kind: 'http', url: url.trim() },
      enabled: true,
    });
    setName('');
    setCommand('');
    setUrl('');
    await refreshTools();
  };

  return (
    <div className="absolute inset-0 z-10 ai-overlay-acrylic animate-ai-drawer-in flex flex-col">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border-subtle">
        <span className="text-xs font-medium">{t(lang, 'aiMcpServers')}</span>
        <span className="text-[11px] text-text-secondary">{t(lang, 'aiMcpServersHint')}</span>
        <button className="ml-auto p-1 rounded hover:bg-bg-hover" onClick={onClose} title={t(lang, 'aiClose')}>
          <X size={13} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-xs">
        {servers.length === 0 && <div className="text-text-secondary">{t(lang, 'aiNoServers')}</div>}
        {servers.map((srv) => (
          <div key={srv.id} className="flex items-center gap-2 rounded border border-border-subtle px-2 py-1.5">
            <input
              type="checkbox"
              checked={srv.enabled}
              onChange={(e) => { void setServerEnabled(srv.id, e.target.checked); }}
              className="accent-accent"
            />
            <span className="font-medium">{srv.name}</span>
            <span className="text-text-secondary truncate">
              {srv.transport.kind === 'stdio'
                ? `${srv.transport.command} ${srv.transport.args.join(' ')}`
                : srv.transport.url}
            </span>
            <button
              className="ml-auto p-1 rounded text-text-secondary hover:bg-bg-hover hover:text-danger"
              onClick={() => { void removeServer(srv.id); }}
              title={t(lang, 'aiDeleteServer')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        <div className="rounded border border-border-subtle px-2 py-1.5 space-y-1.5">
          <div className="font-medium text-text-secondary">{t(lang, 'aiAddServer')}</div>
          <div className="flex gap-1.5">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'stdio' | 'http')}
              className="bg-bg-hover rounded px-1 py-0.5 outline-none"
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(lang, 'aiServerName')}
              className="flex-1 min-w-0 bg-bg-hover rounded px-1.5 py-0.5 outline-none focus:ring-1 ring-accent"
            />
          </div>
          {kind === 'stdio' ? (
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t(lang, 'aiServerCommand')}
              className="w-full bg-bg-hover rounded px-1.5 py-0.5 outline-none focus:ring-1 ring-accent"
            />
          ) : (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:8000/mcp"
              className="w-full bg-bg-hover rounded px-1.5 py-0.5 outline-none focus:ring-1 ring-accent"
            />
          )}
          <button
            className="px-2 py-0.5 rounded bg-accent text-accent-foreground disabled:opacity-40 flex items-center gap-1"
            disabled={!canAdd}
            onClick={() => { void onAdd(); }}
          >
            <Plus size={11} />
            {t(lang, 'aiAddServer')}
          </button>
        </div>

        {tools.length > 0 && (
          <div className="pt-1">
            <div className="font-medium text-text-secondary pb-1">
              {t(lang, 'aiToolCount').replace('{n}', String(tools.length))}
            </div>
            <div className="flex flex-wrap gap-1">
              {tools.map((tool) => (
                <span
                  key={`${tool.server_id}-${tool.name}`}
                  title={tool.description}
                  className="px-1.5 py-0.5 rounded bg-bg-hover text-[10px]"
                >
                  {tool.prefixed_name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/// AI 对话面板 — 可停靠 (右/左/下/浮动), 流式对话 + Markdown 渲染 +
/// 多会话 (后端持有) + MCP 工具调用展示 + 本地 MCP server 管理
export function AiChatPanel() {
  const lang = useAppStore((s) => s.lang);
  const {
    viewItems,
    streaming,
    streamingSessionId,
    activeSessionId,
    streamingText,
    reasoningText,
    toolRuns,
    tools,
    serverRunning,
    serverPort,
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedBottom = useRef(true);

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
    if (el && pinnedBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [viewItems, streamingText, reasoningText, toolRuns]);

  const onSend = () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || streaming) return;
    setInput('');
    const atts = attachments;
    setAttachments([]);
    void send(text, atts);
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
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
        <span className="text-xs font-medium shrink-0">{t(lang, 'aiChat')}</span>
        <SessionMenu />
        <button
          className="flex items-center gap-1 px-1.5 h-5 rounded text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary shrink-0"
          onClick={() => setDrawerOpen(true)}
          title={t(lang, 'aiMcpServers')}
        >
          <Plug size={11} />
          {t(lang, 'aiToolCount').replace('{n}', String(tools.length))}
        </button>
        <span
          className={`text-[10px] px-1.5 h-4 flex items-center rounded shrink-0 ${
            serverRunning ? 'bg-success/15 text-success' : 'bg-bg-hover text-text-secondary'
          }`}
          title={serverRunning ? `127.0.0.1:${serverPort ?? ''}/mcp` : t(lang, 'aiServerStopped')}
        >
          {serverRunning ? `MCP :${serverPort ?? ''}` : t(lang, 'aiServerStopped')}
        </span>
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
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
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2 text-xs"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
      >
        {viewItems.length === 0 && !showStreaming && (
          <div className="h-full flex items-center justify-center text-text-secondary">{t(lang, 'aiPlaceholder')}</div>
        )}
        {viewItems.map((item, i) =>
          item.role === 'user' ? (
            <div key={i} className="flex justify-end animate-ai-msg-in">
              <div className="max-w-[85%] rounded-lg px-2.5 py-1.5 bg-accent text-accent-foreground space-y-1">
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
            <div className="max-w-[92%] rounded-lg px-2.5 py-1.5 space-y-1.5 bg-bg-hover">
              {toolRuns.map((run) => (
                <ToolRunCard key={run.id} run={run} />
              ))}
              {reasoningText && (
                <div className="whitespace-pre-wrap break-words text-text-secondary/70 italic line-clamp-3">
                  {reasoningText}
                </div>
              )}
              {streamingText && <AiMarkdown text={streamingText} />}
              <span className="inline-block w-1.5 h-3 align-text-bottom bg-accent animate-pulse" />
            </div>
          </div>
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
        className={`border-t border-border-subtle shrink-0 ${dragOver ? 'ring-1 ring-inset ring-accent' : ''}`}
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
        <div className="flex items-end gap-2 px-3 py-2">
          <button
            className="p-1.5 mb-px rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40 shrink-0"
            onClick={() => void onPickAttachments()}
            disabled={streaming}
            title={t(lang, 'aiAttach')}
          >
            <Paperclip size={13} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t(lang, 'inputMessage')}
            rows={1}
            className="flex-1 resize-none bg-bg-hover rounded px-2 py-1.5 text-xs outline-none focus:ring-1 ring-accent max-h-24"
          />
          {streaming ? (
            <button
              className="h-7 px-2.5 rounded bg-danger text-white text-xs flex items-center gap-1 shrink-0"
              onClick={() => void cancel()}
            >
              <Square size={11} />
              {t(lang, 'aiStop')}
            </button>
          ) : (
            <button
              className="h-7 px-2.5 rounded bg-accent text-accent-foreground text-xs flex items-center gap-1 shrink-0 disabled:opacity-40"
              onClick={onSend}
              disabled={(!input.trim() && attachments.length === 0) || !activeSessionId || !!sendIssue}
            >
              <Send size={11} />
              {t(lang, 'aiSend')}
            </button>
          )}
        </div>
      </div>

      {drawerOpen && <McpDrawer onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}

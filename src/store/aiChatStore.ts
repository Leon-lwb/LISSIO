import { create } from 'zustand';
import { api } from '../lib/tauri/tauri';
import { notify } from '../lib/tauri/notifications';
import { formatAiKindError } from '../lib/ai/aiErrors';
import { checkAiProviderSettings } from '../settings/aiProvider';
import { useSettingsStore } from './settingsStore';
import { useAppStore } from './appStore';
import { t } from '../i18n';
import type { AiAttachment, AiViewItem } from '../types';
import type { AiChatState } from './aiChatStoreTypes';
import {
  appendTextEvent,
  errorItemFromRejection,
  openChatChannel,
  providerConfigFromSettings,
} from './aiChatStoreSupport';

export type { AiChatState } from './aiChatStoreTypes';


/// Streaming updates are batched over roughly three frames.
const STREAM_FLUSH_MS = 50;

/// Flush the current stream buffer before terminal state settlement.
let flushStreaming: (() => void) | null = null;

export const useAiChatStore = create<AiChatState>()((set, get) => {
  /** 后端条目 → 视图条目 (同构, 仅收紧类型) */
  const toViewItems = (items: AiViewItem[]): AiViewItem[] =>
    items.map((it) => ({ ...it, tools: it.tools?.map((t) => ({ ...t })) }));

  /**
   * 发起一次对话任务 (send / regenerate 共用)。
   * `failLocal`: 命令级失败 (配置错误等, 无事件流) 时的本地呈现。
   */
  const startTask = async (
    sessionId: string,
    payload: { text: string | null; attachments: AiAttachment[] | null; regenerate: boolean },
    failLocal: (err: unknown) => void
  ) => {
    const ai = useSettingsStore.getState().settings.ai;
    // 通道由出口构造 — Web 出口未接入 AI 命令, 构造即抛结构化错误
    // (kind=UnsupportedCommand), 因此 AI 面板在浏览器里给出明确提示,
    // 而不是 Tauri 运行时缺失时的无 kind TypeError。
    const channel = openChatChannel(failLocal);
    if (!channel) return;
    // 流式增量合批 — 一个窗口内的 delta 合并成一次 store 更新。逐个 token 触发
    // 全量重渲染会把渲染进程拖垮 (长会话 + 长回复时表现为白屏后自动重载):
    // 窗口内保持事件顺序, 工具/终态事件先冲刷缓冲再处理, 不丢也不乱序。
    let pending: { kind: 'text' | 'reasoning'; text: string }[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPending = () => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pending.length === 0) return;
      const chunks = pending;
      pending = [];
      set((s) => {
        let streamingText = s.streamingText;
        let reasoningText = s.reasoningText;
        let timeline = s.timeline;
        for (const chunk of chunks) {
          if (chunk.kind === 'text') {
            streamingText += chunk.text;
            timeline = appendTextEvent(timeline, 'text', chunk.text);
          } else {
            reasoningText += chunk.text;
            timeline = appendTextEvent(timeline, 'reasoning', chunk.text);
          }
        }
        return { streamingText, reasoningText, timeline };
      });
    };
    const pushDelta = (kind: 'text' | 'reasoning', text: string) => {
      if (!text) return;
      const last = pending.length > 0 ? pending[pending.length - 1] : undefined;
      if (last?.kind === kind) last.text += text;
      else pending.push({ kind, text });
      flushTimer ??= setTimeout(flushPending, STREAM_FLUSH_MS);
    };
    flushStreaming = flushPending;
    channel.onmessage = (event) => {
      switch (event.type) {
        case 'delta':
          pushDelta('text', event.text);
          break;
        case 'reasoning_delta':
          pushDelta('reasoning', event.text);
          break;
        case 'tool_call':
          flushPending();
          set((s) => ({
            timeline: [...s.timeline, { kind: 'tool', id: event.id }],
            toolRuns: [
              ...s.toolRuns,
              { id: event.id, name: event.name, arguments: event.arguments, text_offset: s.streamingText.length, content: '', is_error: false, done: false },
            ],
          }));
          break;
        case 'tool_result': {
          flushPending();
          const renamed = !event.is_error && get().toolRuns.some(
            (run) => run.id === event.id && run.name === 'set_conversation_title'
          );
          set((s) => ({
            toolRuns: s.toolRuns.map((r) =>
              r.id === event.id ? { ...r, content: event.content, is_error: event.is_error, done: true } : r
            ),
          }));
          if (renamed) {
            void api.chatListSessions().then((sessions) => set({ sessions })).catch(() => undefined);
          }
          break;
        }
        case 'done':
        case 'cancelled':
        case 'error':
          flushPending();
          void finishTurn();
          break;
      }
    };

    try {
      const lang = useAppStore.getState().lang;
      const taskId = await api.aiChatSend(
        sessionId,
        payload.text,
        payload.attachments,
        payload.regenerate,
        providerConfigFromSettings(),
        ai.mcpToolsEnabled,
        ai.pluginsEnabled && ai.builtinToolsEnabled,
        ai.pluginsEnabled && ai.webToolsEnabled,
        lang,
        channel
      );
      set({ taskId });
    } catch (e) {
      flushStreaming = null;
      failLocal(e);
    }
  };

  /** 回合收束 (done/cancelled/error 共用) — 后端已落盘, 拉取权威视图对账 */
  const finishTurn = async () => {
    // 收束前先冲刷合批缓冲 — 否则最后一段流式文本会漏进本地聚合
    flushStreaming?.();
    flushStreaming = null;
    const s = get();
    const patch = {
      streaming: false,
      streamingText: '',
      reasoningText: '',
      timeline: [],
      toolRuns: [],
      taskId: null,
      streamingSessionId: null,
    };
    // 后端不可达 (HMR 场景): 退化为本地聚合, 不丢已收到的内容
    const foldLocal = (items: AiViewItem[]): AiViewItem[] => {
      const tools = s.toolRuns.map((r) => ({ ...r }));
      const out = [...items];
      if (s.streamingText || s.reasoningText || tools.length > 0) {
        out.push({ role: 'assistant', text: s.streamingText, reasoning: s.reasoningText, tools, timeline: s.timeline });
      }
      return out;
    };
    if (!s.activeSessionId || s.activeSessionId !== s.streamingSessionId) {
      set(patch);
      return;
    }
    try {
      const session = await api.chatGetSession(s.activeSessionId);
      set({ ...patch, viewItems: toViewItems(session?.items ?? []) });
      void api.chatListSessions().then((sessions) => set({ sessions })).catch(() => undefined);
    } catch {
      set((cur) => ({ ...patch, viewItems: foldLocal(cur.viewItems) }));
    }
  };

  return {
    sessions: [],
    activeSessionId: null,
    viewItems: [],
    streaming: false,
    streamingSessionId: null,
    streamingText: '',
    reasoningText: '',
    timeline: [],
    toolRuns: [],
    taskId: null,
    tools: [],
    servers: [],
    serverRunning: false,
    serverPort: null,

    refreshSessions: async () => {
      try {
        const sessions = await api.chatListSessions();
        const { activeSessionId } = get();
        // 回退到最近活动的会话: 后端按存储顺序返回 (不是时间序), 重载后 store 为空时
        // 取 sessions[0] 会落回最早建的会话, 用户看到的就是"历史丢了"。
        const fallback = [...sessions].sort((a, b) => b.updated_at - a.updated_at)[0]?.id ?? null;
        set({
          sessions,
          // 当前会话已被删除 (他端) 时回退到最近一个会话
          activeSessionId: sessions.some((s) => s.id === activeSessionId)
            ? activeSessionId
            : fallback,
        });
        if (get().activeSessionId) await get().switchSession(get().activeSessionId!);
      } catch {
        /* 后端不可达时静默 (HMR 场景) */
      }
    },

    createSession: async (title) => {
      try {
        const session = await api.chatCreateSession(title);
        set((s) => ({
          sessions: [
            ...s.sessions,
            {
              id: session.id,
              title: session.title,
              created_at: session.created_at,
              updated_at: session.updated_at,
              item_count: session.items.length,
            },
          ],
          activeSessionId: session.id,
          viewItems: [],
          streamingText: '',
          reasoningText: '',
          timeline: [],
          toolRuns: [],
        }));
      } catch {
        /* ignore */
      }
    },

    switchSession: async (id) => {
      set({ activeSessionId: id });
      try {
        const session = await api.chatGetSession(id);
        set({ viewItems: toViewItems(session?.items ?? []) });
      } catch {
        set({ viewItems: [] });
      }
    },

    renameSession: async (id, title) => {
      await api.chatRenameSession(id, title);
      set((s) => ({
        sessions: s.sessions.map((m) => (m.id === id ? { ...m, title } : m)),
      }));
    },

    deleteSession: async (id) => {
      await api.chatDeleteSession(id);
      const rest = get().sessions.filter((s) => s.id !== id);
      set({ sessions: rest });
      if (get().activeSessionId === id) {
        if (rest.length > 0) {
          await get().switchSession(rest[0].id);
        } else {
          set({ activeSessionId: null, viewItems: [] });
        }
      }
    },

    send: async (text, attachments = []) => {
      const { streaming, activeSessionId, viewItems } = get();
      const body = text.trim();
      const atts = attachments.filter((a) => a.content);
      if (streaming || (!body && atts.length === 0) || !activeSessionId) return;

      // 发送前检查 (与后端 validate_config 同规则): 配置缺失直接拦截, 不发请求
      const issue = checkAiProviderSettings(useSettingsStore.getState().settings.ai);
      if (issue) {
        const lang = useAppStore.getState().lang;
        const view = formatAiKindError(issue.kind, issue.params, '', lang);
        notify.error(t(lang, 'aiSendBlocked'), view.summary, { source: 'ai-send' });
        return;
      }

      set({
        viewItems: [...viewItems, { role: 'user', text: body, attachments: atts.length > 0 ? atts : undefined }],
        streaming: true,
        streamingSessionId: activeSessionId,
        streamingText: '',
        reasoningText: '',
        timeline: [],
        toolRuns: [],
      });

      await startTask(
        activeSessionId,
        { text: body || null, attachments: atts.length > 0 ? atts : null, regenerate: false },
        // 命令级失败: 后端未写入, 本地呈现结构化错误条目 (kind/data 透传供本地化)
        (err) =>
          set((s) => ({
            streaming: false,
            streamingSessionId: null,
            streamingText: '',
            reasoningText: '',
            timeline: [],
            toolRuns: [],
            taskId: null,
            viewItems: [...s.viewItems, errorItemFromRejection(err)],
          }))
      );
    },

    regenerate: async () => {
      const { streaming, activeSessionId, viewItems } = get();
      if (streaming || !activeSessionId) return;
      // 重发同样走发送前检查 (配置可能已失效)
      const issue = checkAiProviderSettings(useSettingsStore.getState().settings.ai);
      if (issue) {
        const lang = useAppStore.getState().lang;
        const view = formatAiKindError(issue.kind, issue.params, '', lang);
        notify.error(t(lang, 'aiSendBlocked'), view.summary, { source: 'ai-send' });
        return;
      }
      // 本地乐观截断: 移除最后一条用户条目之后的条目 (与后端 truncate 对称)
      let lastUser = -1;
      for (let i = viewItems.length - 1; i >= 0; i--) {
        if (viewItems[i].role === 'user') {
          lastUser = i;
          break;
        }
      }
      set({
        viewItems: lastUser >= 0 ? viewItems.slice(0, lastUser + 1) : viewItems,
        streaming: true,
        streamingSessionId: activeSessionId,
        streamingText: '',
        reasoningText: '',
        timeline: [],
        toolRuns: [],
      });

      await startTask(
        activeSessionId,
        { text: null, attachments: null, regenerate: true },
        (err) =>
          set((s) => ({
            streaming: false,
            streamingSessionId: null,
            streamingText: '',
            reasoningText: '',
            timeline: [],
            toolRuns: [],
            taskId: null,
            viewItems: [...s.viewItems, errorItemFromRejection(err)],
          }))
      );
    },

    cancel: async () => {
      const { taskId } = get();
      if (taskId) await api.aiChatCancel(taskId).catch(() => false);
    },

    clearSession: async () => {
      const { activeSessionId } = get();
      if (!activeSessionId) return;
      await api.chatClearSession(activeSessionId);
      set({
        viewItems: [],
        streamingText: '',
        reasoningText: '',
        timeline: [],
        toolRuns: [],
        taskId: null,
        streaming: false,
      });
    },

    refreshTools: async () => {
      try {
        const [tools, servers] = await Promise.all([api.mcpListTools(), api.mcpListServers()]);
        set({ tools, servers });
      } catch {
        /* 后端不可达时静默 (HMR 场景) */
      }
    },

    refreshServers: async () => {
      try {
        set({ servers: await api.mcpListServers() });
      } catch {
        /* ignore */
      }
    },

    refreshServerStatus: async () => {
      try {
        const st = await api.mcpServerStatus();
        set({ serverRunning: st.running, serverPort: st.port });
      } catch {
        /* ignore */
      }
    },

    startLocalServer: async () => {
      const port = useSettingsStore.getState().settings.ai.mcpServerPort;
      try {
        const bound = await api.mcpServerStart(port);
        set({ serverRunning: true, serverPort: bound });
      } catch {
        set({ serverRunning: false });
      }
    },

    stopLocalServer: async () => {
      try {
        await api.mcpServerStop();
      } finally {
        set({ serverRunning: false, serverPort: null });
      }
    },

    addServer: async (config) => {
      await api.mcpAddServer(config);
      await get().refreshServers();
    },

    removeServer: async (id) => {
      await api.mcpRemoveServer(id);
      await get().refreshServers();
      await get().refreshTools();
    },

    setServerEnabled: async (id, enabled) => {
      await api.mcpSetServerEnabled(id, enabled);
      await get().refreshServers();
      await get().refreshTools();
    },
  };
});

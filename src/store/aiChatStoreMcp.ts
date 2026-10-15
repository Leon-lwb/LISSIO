//! 本地 MCP server 的状态与端口动作 — 从 `aiChatStore` 拆出的一个责任面。
//!
//! 端口是用户可见的配置 (`settings.ai.mcpServerPort`), 所以这里的规则很硬:
//! 设置里写的端口就是监听端口, 冲突要带占用者与建议端口回到界面。

import { api } from '../lib/tauri/tauri';
import { notify } from '../lib/tauri/notifications';
import { translate, type Lang } from '../i18n';
import { useSettingsStore } from './settingsStore';
import { useAppStore } from './appStore';
import type { McpPortConflict } from '../types';
import type { AiChatState } from './aiChatStoreTypes';

/// zustand store 的 set / get — 与 `create` 交给状态工厂的那一对同型。
type SetState = (partial: Partial<AiChatState>) => void;
type GetState = () => AiChatState;

/// 端口冲突提示的会话级去重 — 同一 (端口, 原因) 只弹一次; 横幅与状态仍常驻。
const announcedConflicts = new Set<string>();

/** 端口冲突详情: 失败原因 + 占用者 (或"未识别") + 建议端口。 */
function conflictDetail(conflict: McpPortConflict, lang: Lang): string {
  const parts = [conflict.reason];
  parts.push(
    conflict.occupant
      ? translate('aiMcpPortConflictOccupiedBy', lang, { occupant: conflict.occupant })
      : translate('aiMcpPortConflictUnidentified', lang)
  );
  if (conflict.suggested_port !== null) {
    parts.push(translate('aiMcpPortConflictSuggest', lang, { port: conflict.suggested_port }));
  }
  return parts.join(' ');
}

/// 首次发现冲突 (或换了端口/原因) 时提示一次, 附"改用建议端口 / 打开 MCP 设置"。
export function announceConflict(conflict: McpPortConflict | null, onUseSuggestedPort: (port: number) => void): void {
  if (!conflict) return;
  const key = `${conflict.port}:${conflict.reason}`;
  if (announcedConflicts.has(key)) return;
  announcedConflicts.add(key);
  const lang = useAppStore.getState().lang;
  const suggestion = conflict.suggested_port;
  notify.error(
    translate('aiMcpPortConflictTitle', lang, { port: conflict.port }),
    conflictDetail(conflict, lang),
    {
      source: 'ai-mcp-port',
      actions: [
        ...(suggestion === null
          ? []
          : [
              {
                label: translate('aiMcpPortUseSuggestion', lang, { port: suggestion }),
                run: () => onUseSuggestedPort(suggestion),
              },
            ]),
        {
          label: translate('settingsOpenMcp', lang),
          run: () => useSettingsStore.getState().openMcpSettings(),
        },
      ],
    }
  );
}

/// 本地 MCP server 状态刷新 / 启停 / 端口切换动作。
export function createMcpServerActions(set: SetState, get: GetState): Pick<
  AiChatState,
  | 'refreshServerStatus'
  | 'startLocalServer'
  | 'stopLocalServer'
  | 'changeServerPort'
  | 'probePort'
  | 'applyPortSuggestion'
> {
  return {
    refreshServerStatus: async () => {
      try {
        const status = await api.mcpServerStatus();
        announceConflict(status.conflict, (port) => void get().applyPortSuggestion(port));
        set({ serverRunning: status.running, serverPort: status.port, serverConflict: status.conflict });
      } catch {
        /* 后端不可达时静默 (HMR 场景) */
      }
    },

    startLocalServer: async (port) => {
      const target = port ?? useSettingsStore.getState().settings.ai.mcpServerPort;
      try {
        const bound = await api.mcpServerStart(target);
        set({ serverRunning: true, serverPort: bound, serverConflict: null });
      } catch {
        // 失败原因 (占用者 / 建议端口) 由后端状态携带 — 拉回来展示并提示
        set({ serverRunning: false, serverPort: null });
        await get().refreshServerStatus();
      }
    },

    stopLocalServer: async () => {
      try {
        await api.mcpServerStop();
      } finally {
        set({ serverRunning: false, serverPort: null, serverConflict: null });
      }
    },

    changeServerPort: async (port) => {
      useSettingsStore.getState().update('ai', 'mcpServerPort', port);
      // 旧端口的冲突诊断对新端口不成立, 先清掉 (新端口的问题会在启动时重新记录)
      set({ serverConflict: null });
      // 已在监听就立即切到新端口 — 设置里写的端口与实际监听必须一致
      if (get().serverRunning) await get().startLocalServer(port);
    },

    probePort: async (port) => {
      try {
        return await api.mcpPortCheck(port);
      } catch {
        return null;
      }
    },

    applyPortSuggestion: async (port) => {
      await get().changeServerPort(port);
      if (!get().serverRunning) await get().startLocalServer(port);
    },
  };
}

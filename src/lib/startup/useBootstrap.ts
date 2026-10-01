//! bootstrap 阶段 — 设置装配、后端事件监听、端口刷新与 AI 工具宿主接线。
//!
//! 这一段在 `App` 挂载时执行一次 (依赖全是 store 动作, 引用稳定), 是业务树
//! 与后端的第一次对话: 设置 (含外观/容量/管线配置) 先落盘生效, 事件监听把
//! 后端推送接进 store, 端口表与 AI 托管工具宿主随后就位。
//!
//! 卸载语义: 事件监听返回的清理函数在 unmount 时必定执行 (React 18 StrictMode
//! 双挂载下, 第二轮挂载前会先执行第一轮的清理 — `initEventListeners` 自身也
//! 在开头兜底重置, 双保险)。

import { useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { useSettingsStore } from '../../store/settingsStore';
import { initAiToolHost } from '../ai/toolHost';

/** 装配一次性副作用 — 返回值即 unmount 清理 (事件监听注销)。 */
export function useBootstrap(): void {
  const loadSettings = useSettingsStore((s) => s.load);
  const initEventListeners = useAppStore((s) => s.initEventListeners);
  const refreshPorts = useAppStore((s) => s.refreshPorts);

  useEffect(() => {
    void loadSettings();

    let cancelled = false;
    const cleanupRef: { fn: (() => void) | null } = { fn: null };
    void initEventListeners()
      .then((fn) => {
        if (cancelled) fn();
        else cleanupRef.fn = fn;
      })
      .catch((error: unknown) => console.error('Failed to initialize event listeners:', error));

    void refreshPorts();

    // AI 前端托管工具宿主 — 监听 ai_tool_invoke, 让内置 AI 编辑节点/操作软件。
    // 幂等 (toolHost 内部 started 闩), 与事件监听同批接线, 不再挂到无关依赖上。
    initAiToolHost();

    return () => {
      cancelled = true;
      cleanupRef.fn?.();
    };
  }, [initEventListeners, loadSettings, refreshPorts]);
}

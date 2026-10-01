//! first-frame 阶段 — 主窗口放行 (设置加载完成后)。
//!
//! 桌面主窗口一直 `visible: false`, 隐藏窗口的渲染被系统节流; 顺序必须是
//! 「先 `show()` 解除节流 → 等两帧确认已合成 → 关启动页」。完整时序与幂等语义
//! 见 `reveal.ts` (连接诊断页与本 hook 共用同一放行实现), 这里只负责触发时机:
//! **设置加载完成即放行** — 设置是外观/容量等首屏必需品, 与业务目录是否就绪无关。
//!
//! Web 出口未接入窗口命令, `revealMainWindow` 内部对两个命令的失败静默。

import { useEffect } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { revealMainWindow } from './reveal';

export function useFirstFrameReveal(): void {
  const settingsLoaded = useSettingsStore((s) => s.loaded);

  useEffect(() => {
    if (!settingsLoaded) return;
    revealMainWindow();
  }, [settingsLoaded]);
}

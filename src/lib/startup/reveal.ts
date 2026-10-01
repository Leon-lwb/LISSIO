//! 首帧放行 — 唯一的主窗口显示 / 启动页关闭入口。
//!
//! 桌面主窗口在 `tauri.conf.json` 里以 `visible: false` 创建, 隐藏窗口的渲染被
//! 系统节流; 启动页 (`splashscreen` 窗口) 覆盖其上。放行必须严格有序:
//!
//! 1. `show_main_window` — 先 `show()` 解除节流 (隐藏窗口即使画了也白画);
//! 2. 等两次 `requestAnimationFrame` — 保证至少一帧已合成;
//! 3. `close_splashscreen` — 关启动页, 此时主窗口内容已就绪, 消除透明空白期;
//! 4. 1500ms 兜底 — rAF 异常 (后台标签页 / 无帧回调) 时不永久卡在启动页。
//!
//! **放行是幂等的**: 连接诊断页 (`BackendConnectionGate` 失败分支) 与业务树
//! (`App` 的设置加载完成) 都可能成为首个放行方, 全仓只走本实现 —— 另有一条
//! Rust 侧 10 秒强制兜底 (`shell::spawn_splashscreen_fallback`), 互为防线。
//!
//! 本模块只依赖 `transport`, 无 React; 单测用假 transport + 假 rAF 驱动。

import { transport } from '../rpc';

/// 兜底计时 — rAF 不回调时仍关闭启动页 (毫秒)。
const BAILOUT_MS = 1500;

let revealed = false;
let pendingFrames: [number, number] | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function closeSplash(): void {
  void transport.call('close_splashscreen').catch(() => undefined);
}

/** 解除隐藏窗口的渲染节流 (不关启动页) — 放行的第一步。 */
function showMainWindow(): void {
  void transport.call('show_main_window').catch(() => undefined);
}

/**
 * 放行主窗口并关闭启动页 — 幂等, 首次调用生效。
 *
 * 顺序不可调换: 先 `show()` 解除节流, 再等两帧, 最后关启动页 (见模块头)。
 * 两条路径 (连接诊断页 / 设置加载完成) 都调用本函数, 谁先到谁生效;
 * 1500ms 兜底计时与 rAF 各自只触发一次 `close` (rAF 完成时计时器仍会跑完,
 * 但 `close_splashscreen` 幂等, 由 `closeCalls` 限制为一次)。
 */
let closeCalls = 0;

export function revealMainWindow(): void {
  if (revealed) return;
  revealed = true;

  showMainWindow();

  const close = (): void => {
    if (pendingFrames) {
      cancelAnimationFrame(pendingFrames[0]);
      cancelAnimationFrame(pendingFrames[1]);
      pendingFrames = null;
    }
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (closeCalls > 0) return;
    closeCalls += 1;
    closeSplash();
  };

  // 两次 rAF: 第一次保证 show() 已提交, 第二次保证该帧已合成。
  const raf1 = requestAnimationFrame(() => {
    const raf2 = requestAnimationFrame(close);
    if (pendingFrames) pendingFrames = [pendingFrames[0], raf2];
  });
  pendingFrames = [raf1, 0];
  pendingTimer = setTimeout(close, BAILOUT_MS);
}

/** 测试重置 — 仅供单测把幂等闩复位 (生产代码不得调用)。 */
export function resetRevealForTests(): void {
  if (pendingFrames) {
    cancelAnimationFrame(pendingFrames[0]);
    cancelAnimationFrame(pendingFrames[1]);
    pendingFrames = null;
  }
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  revealed = false;
  closeCalls = 0;
}

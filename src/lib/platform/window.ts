//! 桌面窗口控制 — 最小化 / 最大化 / 关闭与 webview 缩放。
//!
//! 这些能力只有 Tauri 宿主窗口具备 (浏览器标签页不能被脚本最小化或关闭), 且仅
//! Windows 自定义菜单栏 (`MenuBar`) 使用。调用点不直接 import
//! `@tauri-apps/api/webviewWindow` — 那会破坏出口封装门禁; 这里收进 platform 目录,
//! 并用 `hasTauriRuntime()` 守卫: 浏览器端不调用 Tauri (模块本身 import 时不触达
//! 宿主), 操作静默 no-op, 菜单项保持可点但不报错。与 `src/lib/rpc/` 的出口守卫同构。
//!
//! 不用动态 import 是有意的: `MenuBar` 的缩放需要"同步发起调用"的语义
//! (既有测试也依赖点击后立即观察到调用), 动态 import 会把调用推迟到下一个微任务。

import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { hasTauriRuntime } from '../rpc';

/// 设置 webview 缩放 (原生菜单 Ctrl+= / Ctrl+- / Ctrl+0)
export async function setWindowZoom(factor: number): Promise<void> {
  if (!hasTauriRuntime()) return;
  await getCurrentWebviewWindow().setZoom(factor);
}

/// 最小化当前窗口
export async function minimizeWindow(): Promise<void> {
  if (!hasTauriRuntime()) return;
  await getCurrentWebviewWindow().minimize();
}

/// 最大化 / 还原当前窗口
export async function toggleMaximizeWindow(): Promise<void> {
  if (!hasTauriRuntime()) return;
  await getCurrentWebviewWindow().toggleMaximize();
}

/// 关闭当前窗口
export async function closeWindow(): Promise<void> {
  if (!hasTauriRuntime()) return;
  await getCurrentWebviewWindow().close();
}

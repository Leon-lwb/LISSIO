//! 平台服务 shim — 运行时选择。
//!
//! `hasTauriRuntime()` 为真 → 桌面实现 (薄委托 Tauri 插件); 否则 → 浏览器实现
//! (服务端设置 / 文件下载 / `window.open`)。判定在模块加载期做一次即可 ——
//! 出口在页面生命周期内不会改变。全应用共用这一份单例。

import { hasTauriRuntime } from '../rpc';
import { tauriPlatform } from './tauri';
import { webPlatform } from './web';
import type { Platform } from './types';

export const platform: Platform = hasTauriRuntime() ? tauriPlatform : webPlatform;

export type { FileFilter, Platform, PlatformStore } from './types';

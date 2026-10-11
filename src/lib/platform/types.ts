//! 平台服务 shim — 契约定义。
//!
//! 同一份 `dist/` 既跑在 Tauri webview (桌面出口), 也跑在普通浏览器 (Web 出口)。
//! 调用点若直接 import Tauri 插件, 浏览器里这些路径就会静默失效或抛错。这里把
//! 插件能力收进一个运行时无关的接口, 由 `index.ts` 按 `hasTauriRuntime()` 装配:
//! 桌面实现薄委托插件 (行为与拆分前逐字一致), 浏览器实现给等价能力或明确降级。
//!
//! 注意: 只有本目录允许 import `@tauri-apps/*` —— 由 `check:web-contract` 强制。

/// 文件对话框过滤器 — 与 `@tauri-apps/plugin-dialog` 的 `DialogFilter` 同形。
/// 此处自定义是为了让浏览器实现不必依赖 Tauri 类型。
export interface FileFilter {
  extensions: string[];
  name: string;
}

/// Desktop/Web share the backend settings document. A resolved write is persisted.
export interface PlatformStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

export interface Platform {
  // @tauri-apps/api/app
  getAppVersion(): Promise<string>;
  getAppName(): Promise<string>;
  // @tauri-apps/plugin-opener
  openUrl(url: string): Promise<void>;
  // @tauri-apps/plugin-process
  exitApp(code?: number): Promise<void>;
  relaunchApp(): Promise<void>;
  // @tauri-apps/plugin-dialog
  saveFile(options: { defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>;
  /// 打开文件 / 目录选择。
  ///
  /// 与设计稿相比补了两处, 都是为了让既有调用点语义不退化:
  /// - `title`: 设置页的目录选择要传原生对话框标题;
  /// - `multiple: true` 时返回 `string[] | null` (设计稿只写了单选) ——
  ///   AI 附件支持多选, 收窄成单文件会是功能回归。
  openFile(options: {
    multiple?: boolean;
    directory?: boolean;
    filters?: FileFilter[];
    title?: string;
  }): Promise<string | string[] | null>;
  confirm(
    message: string,
    options?: { title?: string; kind?: 'info' | 'warning' | 'error' }
  ): Promise<boolean>;
  ask(
    message: string,
    options?: { title?: string; kind?: 'info' | 'warning' | 'error' }
  ): Promise<boolean>;
  // @tauri-apps/plugin-fs  (path 是 saveFile/openFile 返回的不透明句柄)
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
  readBinaryFile(path: string): Promise<Uint8Array>;
  // Connected backend settings (settings.json / key 'app')
  createStore(fileName: string): PlatformStore;
}

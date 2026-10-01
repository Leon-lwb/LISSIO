//! workspace 阶段 — 目录就绪后的描述同步与首次启动种子。
//!
//! 屏障顺序 (`CatalogGate` 保证): 模型目录 ready → `App` 挂载 → 工作区水合
//! (`workspace_ready`) → 本 hook 放行。目录不 ready 时不会恢复/写入工作区,
//! 因此这里调用的两个入口都以「目录必然就绪」为前提:
//!
//! - `startDescribeSync()` — 图变化 → 防抖批量 `describe_node_documents`;
//!   unmount 时 `stopDescribeSync()` 对称拆除 (StrictMode 双挂载安全)。
//! - `seedStartupWorkspace()` — 仅在「水合判定为默认启动 (空工作区)」时创建
//!   一次 RawData 种子; `workspaceRestored=true` 时跳过 (幂等由 in-flight 闩
//!   + 空画布前置检查双保险, 详见 `lib/models/startupSeed.ts`)。

import { useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { startDescribeSync, stopDescribeSync } from '../models/describeStore';
import { seedStartupWorkspace } from '../models/startupSeed';

export function useWorkspaceSeed(): void {
  const workspaceReady = useAppStore((s) => s.workspaceReady);
  const workspaceRestored = useAppStore((s) => s.workspaceRestored);

  useEffect(() => {
    if (!workspaceReady) return undefined;

    startDescribeSync();
    if (!workspaceRestored) void seedStartupWorkspace();

    return () => stopDescribeSync();
  }, [workspaceReady, workspaceRestored]);
}

// ============ 列表面板上滚 → 工作区暂停 (生产绑定) ============
//
// 纯逻辑在 [`scrollPauseController`] (引用计数 + 暂停归属判定); 本模块只做两件事:
//
//   1. 把协调器接到 store — 运行态读 UI 镜像, 动作走 `workspaceRun`;
//      运行态变化 (含用户手动 start/stop) 回报协调器以放弃归属;
//   2. 向列表面板暴露一个 hook: 上报"是否已上滚脱离最新"。
//
// 任一列表面板上滚即暂停工作区 (暂停只停自动发送/设备写, 采集照常), 用户回到底部
// 时若本次暂停确由滚动发起则自动恢复。多张卡片共享同一个工作区开关, 故用 key 计数。

import { useEffect, useId } from 'react';

import { createScrollPauseController } from './scrollPauseController';
import { useAppStore } from '../../store/appStore';

/// 全局单例 — 全列表面板共享 (工作区只有一个)
const controller = createScrollPauseController({
  getRunState: () => useAppStore.getState().runState,
  run: (action) => {
    void useAppStore.getState().workspaceRun(action);
  },
});

// 运行态是唯一权威输入: 命令返回、`workspace:run` 事件与其他写入方都收敛到 runState。
// 用户手动 start/stop 覆盖本次滚动暂停时, 协调器据此放弃归属 (绝不再自动启动)。
useAppStore.subscribe((state, previous) => {
  if (state.runState !== previous.runState) {
    controller.notifyRunState(state.runState);
  }
});

/// 上报面板脱离状态: `detached` (已上滚离开最新) 为 true 时登记为该面板持有暂停;
/// 回到最新或面板卸载时释放。`panelKey` 为 null 时退化为实例私有的稳定 id。
export function useListScrollPause(panelKey: string | null, detached: boolean): void {
  const fallbackKey = useId();
  const key = panelKey ?? fallbackKey;
  useEffect(() => {
    if (!detached) return;
    controller.begin(key);
    return () => controller.end(key);
  }, [key, detached]);
}

/// 只读快照 (测试/调试): 当前处于"上滚脱离"的卡片 key
export function listScrollPauseHolders(): readonly string[] {
  return controller.holders();
}

/// 只读快照 (测试/调试): 当前暂停是否由滚动发起且未被用户覆盖
export function listScrollPauseOwned(): boolean {
  return controller.ownsPause();
}

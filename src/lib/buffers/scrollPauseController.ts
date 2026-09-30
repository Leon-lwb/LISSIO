// ============ RawData 滚动暂停协调器 ============
//
// 多张 RAWDATA 卡片共享同一个"工作区暂停"开关, 故需要引用计数 + 归属判定:
//
//   - 任一卡片上滚 (脱离最新) → 计数 +1; 无归属时 (工作区正在运行) 暂停工作区
//   - 只有"暂停是本次滚动触发"时才在计数归零时自动恢复; 用户手动暂停/停止
//     过的工作区绝不被动启动 (notifyRunState 里放弃归属)
//   - 上滚时工作区本就处于 stopped/paused → 不认领归属, 后续也绝不自动 start
//
// 纯逻辑 (不依赖 store / React), 由组件层注入 getRunState 与 run。

import type { RunAction, RunState } from '../../types';

export interface ScrollPauseDeps {
  /// 当前工作区运行态 (权威在 Rust, 此处读 UI 镜像)
  getRunState: () => RunState;
  /// 触发工作区动作 (pause / start)
  run: (action: RunAction) => void;
}

export interface ScrollPauseController {
  /// 某卡片进入"上滚脱离最新" — 首次进入时可能暂停工作区
  begin: (key: string) => void;
  /// 某卡片回到底部/卸载 — 计数归零且归属在己时恢复工作区
  end: (key: string) => void;
  /// 工作区运行态变化 — 非本次滚动造成的状态变动即放弃归属
  notifyRunState: (state: RunState) => void;
  /// 当前处于"上滚脱离"的卡片 key (只读快照, 供测试与调试)
  holders: () => readonly string[];
  /// 当前这次暂停是否由本协调器发起 (且未被用户覆盖)
  ownsPause: () => boolean;
}

export function createScrollPauseController(deps: ScrollPauseDeps): ScrollPauseController {
  const holders = new Set<string>();
  let owns = false;

  return {
    begin: (key) => {
      if (holders.has(key)) return;
      holders.add(key);
      // 本次暂停已由某张卡片的滚动发起 → 只计数
      if (owns) return;
      // 只在工作区正在运行时认领: 已停止/已由用户暂停 → 不认领, 也不改动状态。
      // 判定依据是"当前无归属"而非"计数从 0 变 1": 停止期间上滚的卡片会留下计数,
      // 若只看首次进入, 这些陈旧计数会让运行后的新上滚再也无法触发暂停。
      if (deps.getRunState() === 'running') {
        owns = true;
        deps.run('pause');
      }
    },

    end: (key) => {
      if (!holders.delete(key)) return;
      if (holders.size > 0) return;
      if (!owns) return;
      owns = false;
      // 暂停期间用户可能已停止工作区 — 只在仍是 paused 时恢复
      if (deps.getRunState() === 'paused') deps.run('start');
    },

    notifyRunState: (state) => {
      // 认领期间出现任何非 paused 状态 = 用户手动 start/stop 覆盖了本次滚动暂停
      if (owns && state !== 'paused') owns = false;
    },

    holders: () => Array.from(holders),
    ownsPause: () => owns,
  };
}

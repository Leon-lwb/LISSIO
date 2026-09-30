//! 显示时效派生层 — "及时显示 / 非及时显示" 的唯一来源。
//!
//! 派生规则 (全部实时面板共用一条):
//!
//! ```text
//! 及时 (live) = 工作区运行中 && 面板跟随最新
//! ```
//!
//! - 工作区暂停/停止 → 非及时: 面板保留最后一帧。暂停时传输层取消显示订阅
//!   (见 `lib/rpc/livePushGate`), 停止时保留订阅以读取保留缓存 — 两种情况下
//!   "是否及时"都由本层派生, 面板不再各写一套判断;
//! - 面板被用户拖离最新 (波形 `hPosition > 0` / `running = false`、列表上滚、
//!   关闭自动滚动) → 该面板非及时, 直到回到最新。
//!
//! 从暂停恢复到运行时, 本层统一广播"跳最新" — 面板把视图锚点复位到实时跟随,
//! 而不是从冻结处继续显示。停止 → 启动不触发 (停止后仍按既有语义浏览缓存)。
//!
//! 分层: 本模块只做派生与广播, 不含 React; 传输层的订阅开关在
//! `lib/rpc/livePushGate`, 面板侧的 React 绑定与角标在
//! `components/displays/common/PanelLiveness`。

import { create } from 'zustand';

import { setDisplayPushSuspended } from '../lib/rpc/livePushGate';
import type { RunState } from '../types';

interface DisplayLivenessState {
  runState: RunState;
  /// 面板是否跟随最新 — 缺省 `true` (只显示最新快照的面板无需上报)
  following: Record<string, boolean>;
}

export const useDisplayLivenessStore = create<DisplayLivenessState>()(() => ({
  runState: 'stopped',
  following: {},
}));

/// 派生: 面板是否处于及时显示
export function derivePanelLive(runState: RunState, following: boolean): boolean {
  return runState === 'running' && following;
}

/// 某面板当前是否及时 (非 React 侧读取)
export function isPanelLive(panelKey: string): boolean {
  const { runState, following } = useDisplayLivenessStore.getState();
  return derivePanelLive(runState, following[panelKey] ?? true);
}

/// 工作区运行态变化 — 统一驱动实时推送门与"从暂停恢复跳最新"。
///
/// 由 store 的运行态镜像调用一次即可; 面板不直接消费运行态做时效判断。
export function setWorkspaceRunState(next: RunState): void {
  const previous = useDisplayLivenessStore.getState().runState;
  if (previous === next) return;
  useDisplayLivenessStore.setState({ runState: next });
  // 暂停: 冻结实时推送。停止保留订阅 — 面板仍要读取保留缓存显示冻结画面。
  setDisplayPushSuspended(next === 'paused');
  // 从暂停恢复: 全部面板跳回最新 (停止 → 启动保持既有语义)
  if (previous === 'paused' && next === 'running') requestGoLive();
}

/// 面板上报"是否跟随最新" — 可在滚动/拖拽事件里直接调用, 不要求面板重渲染。
export function reportPanelFollowing(panelKey: string, following: boolean): void {
  if (useDisplayLivenessStore.getState().following[panelKey] === following) return;
  useDisplayLivenessStore.setState((prev) => ({
    following: { ...prev.following, [panelKey]: following },
  }));
}

/// 面板卸载 — 清除上报 (残留的"已离开最新"不得影响后续挂载)
export function clearPanelFollowing(panelKey: string): void {
  useDisplayLivenessStore.setState((prev) => {
    if (!(panelKey in prev.following)) return prev;
    const following = { ...prev.following };
    delete following[panelKey];
    return { following };
  });
}

type GoLiveHandler = () => void;

const goLiveHandlers = new Map<string, Set<GoLiveHandler>>();

/// 注册"跳回最新"处理器 (按面板 key); 返回注销函数。
///
/// 处理器必须是稳定引用 (面板内 `useCallback`), 它在广播时同步执行:
/// 把视图锚点 (波形 `hPosition` / 列表滚动位置 / 自动滚动态) 复位到实时跟随。
export function onGoLive(panelKey: string, handler: GoLiveHandler): () => void {
  const handlers = goLiveHandlers.get(panelKey) ?? new Set<GoLiveHandler>();
  handlers.add(handler);
  goLiveHandlers.set(panelKey, handlers);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) goLiveHandlers.delete(panelKey);
  };
}

/// 请求全部面板跳回最新 — 由 [`setWorkspaceRunState`] 在暂停恢复时统一触发。
export function requestGoLive(): void {
  for (const handlers of [...goLiveHandlers.values()]) {
    for (const handler of [...handlers]) handler();
  }
}

/// 测试/应用卸载 — 清空注册表、上报状态与推送门。
export function resetDisplayLiveness(): void {
  goLiveHandlers.clear();
  setDisplayPushSuspended(false);
  useDisplayLivenessStore.setState({ runState: 'stopped', following: {} });
}

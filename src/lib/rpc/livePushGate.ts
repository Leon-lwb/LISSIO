//! 显示推送门 — 工作区暂停时冻结画面。
//!
//! 暂停只停设备发送: 后端照常采集、求值并把数据写进波形/原始数据/CAN/逻辑
//! 缓存与录制, 展示层按契约冻结画面。冻结的做法是暂停时取消显示订阅、恢复时
//! 按原请求重订阅 — 后端对增量型订阅会重放近端历史 (CAN 帧回溯最近历史、波形
//! 窗口是快照), 因此冻结期间的数据不会在视图里丢失, 恢复后画面直接追上。
//!
//! 只有**显示数据**走本门 (`subscribe_data` 的显示流)。控制/事件类订阅
//! (`workspace:run`、编译事件、通知) 不经过它 — 否则运行状态事件本身就被冻结。

import { transport } from './index';
import type { SubscribeOptions, SubscriptionHandle } from './types';

interface GateEntry {
  start: () => void;
  stop: () => void;
}

const entries = new Set<GateEntry>();
let suspended = false;

/// 冻结/恢复全部显示推送 — 由运行态镜像驱动 (`runState === 'paused'`)。
export function setDisplayPushSuspended(next: boolean): void {
  if (suspended === next) return;
  suspended = next;
  for (const entry of entries) {
    if (next) entry.stop();
    else entry.start();
  }
}

/// 当前是否处于冻结态 (诊断 / 测试用)。
export function isDisplayPushSuspended(): boolean {
  return suspended;
}

/// 受显示门控的订阅 — 与 [`Transport.subscribe`] 同形, 句柄身份跨冻结期稳定。
///
/// 冻结期间建立: 先登记不建流, 恢复时统一建流。冻结期间取消: 不建流也不重订。
export function subscribeDisplayTransport<T>(
  request: unknown,
  sink: (payload: T) => void,
  options?: SubscribeOptions,
): SubscriptionHandle {
  let inner: SubscriptionHandle | null = null;
  let cancelled = false;
  // 冻结期没有内层订阅: settled 立即 resolve, 订阅方的生命周期对账照常推进
  const idleSettled = Promise.resolve();

  const start = () => {
    if (cancelled || suspended || inner) return;
    inner = transport.subscribe<T>(request, sink, options);
  };
  const stop = () => {
    inner?.cancel();
    inner = null;
  };

  const entry: GateEntry = { start, stop };
  entries.add(entry);

  const handle: SubscriptionHandle = {
    get id() {
      return inner ? inner.id : null;
    },
    get settled() {
      return inner ? inner.settled : idleSettled;
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      entries.delete(entry);
      stop();
    },
  };

  start();
  return handle;
}

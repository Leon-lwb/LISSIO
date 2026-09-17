//! 桌面出口 — Tauri IPC 实现。
//!
//! 这是行为基线: 命令走 `invoke`, 事件走 `listen`, 显示流走 `Channel`
//! (`InvokeResponseBody::Raw` → `ArrayBuffer` 零拷贝, 波形/包络/样本的快路径)。
//! 所有逻辑与拆分前逐一对应, 只是从各调用点收敛到一处。

import { Channel, invoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import type { EventChannel, SubscribeOptions, SubscriptionHandle, Transport } from './types';

/// 关闭 Tauri Channel 的完整流程:
/// 1. 调用后端 unsubscribe 命令, 从订阅者列表移除 (停止 send)
/// 2. 注销 JS 端回调 (cleanupCallback, 防止 callback id 残留)
/// 3. 清空 onmessage handler
///
/// 必须先调用后端移除再注销 JS 回调, 否则后端在 send 时找不到回调 ID 会产生警告。
async function closeChannel<T>(
  channel: Channel<T>,
  unsubscribeCmd: string,
  channelId: number,
): Promise<void> {
  try {
    await invoke(unsubscribeCmd, { channelId });
  } catch {
    // 后端可能已不可达 (HMR / 重载), 忽略
  }
  const ch = channel as unknown as { cleanupCallback?: () => void };
  if (typeof ch.cleanupCallback === 'function') {
    ch.cleanupCallback();
  }
  channel.onmessage = () => undefined;
}

export const tauriTransport: Transport = {
  kind: 'tauri',

  // 无参命令保持 `invoke(cmd)` 的调用形状 — 与拆分前逐字一致, 便于对照与桩断言
  call: <T>(cmd: string, args?: Record<string, unknown>) =>
    args === undefined ? invoke<T>(cmd) : invoke<T>(cmd, args),

  listen: async <T>(event: string, handler: (payload: T) => void) => {
    const unlisten = await tauriListen<T>(event, (e) => handler(e.payload));
    return unlisten;
  },

  eventChannel: <T>() => new Channel<T>() as EventChannel<T>,

  subscribe: <T>(
    request: unknown,
    sink: (payload: T) => void,
    options?: SubscribeOptions,
  ): SubscriptionHandle => {
    let cancelled = false;
    const channel = new Channel<T>();
    channel.onmessage = (payload) => {
      if (!cancelled) sink(payload);
    };
    // 建立期间的取消要注销两次: `cancel()` 的那次可能与 subscribe 竞态 (后端先处理后
    // 注册), 因此 invoke 落地后再补一次。失败只经 onError 上报, `settled` 恒 resolve。
    const settled = invoke('subscribe_data', {
      request,
      onEvent: channel,
      intervalMs: options?.intervalMs,
      maxItems: options?.maxItems,
    }).then(
      () => {
        if (cancelled) void closeChannel(channel, 'unsubscribe_data', channel.id);
      },
      (error: unknown) => {
        options?.onError?.(error);
      },
    );
    return {
      get id() {
        return channel.id;
      },
      settled,
      cancel() {
        if (cancelled) return;
        cancelled = true;
        void closeChannel(channel, 'unsubscribe_data', channel.id);
      },
    };
  },
};

import { transport } from '../rpc';
import type { SubscriptionHandle } from '../rpc/types';
import { tickMetric, perfEvent } from '../utils/perfLog';

export type DisplayKind =
  | 'string_outputs'
  | 'spectrum'
  | 'measurements'
  | 'waveform'
  | 'raw_data'
  | 'can_frames'
  | 'logic_samples'
  | 'decoded_events'
  | 'can_load';

export interface DisplayEvent<T> {
  kind: DisplayKind;
  payload: T;
}

/// 显示数据统一订阅入口 — 每个逻辑订阅一路后端有序流。
/// 后端 Actor 保证事件顺序, 推送按 intervalMs 节流; kind 不符的消息视为契约破坏并报错。
export function subscribeDisplay<T>(
  request: Record<string, unknown>,
  expectedKind: DisplayKind,
  sink: (value: T) => void,
  options?: { intervalMs?: number; maxItems?: number; onError?: (error: unknown) => void },
): SubscriptionHandle {
  // 调试: 统计该订阅的消息速率 (payload 字节由各订阅包装补充)
  const countedSink = (event: DisplayEvent<T>) => {
    if (event.kind !== expectedKind) {
      const error = new Error(
        `显示订阅类型不匹配: expected=${expectedKind}, actual=${event.kind}`,
      );
      console.error(error);
      options?.onError?.(error);
      return;
    }
    tickMetric(`display:${expectedKind}`);
    sink(event.payload);
  };
  perfEvent(`subscribe display:${expectedKind}`);

  return transport.subscribe<DisplayEvent<T>>(request, countedSink, {
    ...options,
    onError: (error) => {
      console.error(`显示订阅失败 (${expectedKind}):`, error);
      options?.onError?.(error);
    },
  });
}

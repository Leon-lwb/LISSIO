import { invoke, Channel } from '@tauri-apps/api/core';
import { closeTauriChannel } from '../tauri/tauri';
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

/// 显示数据统一订阅入口 — 每个逻辑订阅一个 Tauri Channel。
/// 后端 Actor 保证事件顺序, 推送按 intervalMs 节流; kind 不符的消息视为契约破坏并报错。
export function subscribeDisplay<T>(
  request: Record<string, unknown>,
  expectedKind: DisplayKind,
  sink: (value: T) => void,
  options?: { intervalMs?: number; maxItems?: number },
): { cancel: () => void } {
  let cancelled = false;

  // 调试: 统计该订阅的消息速率 (payload 字节由各订阅包装补充)
  const countedSink = (event: DisplayEvent<T>) => {
    if (event.kind !== expectedKind) {
      console.error(
        `显示订阅类型不匹配: expected=${expectedKind}, actual=${event.kind}`,
      );
      return;
    }
    tickMetric(`display:${expectedKind}`);
    sink(event.payload);
  };
  perfEvent(`subscribe display:${expectedKind}`);

  const channel = new Channel<DisplayEvent<T>>();
  channel.onmessage = countedSink;

  void (async () => {
    try {
      await invoke('subscribe_data', {
        request,
        onEvent: channel,
        ...options,
      });
      if (cancelled) {
        void closeTauriChannel(channel, 'unsubscribe_data', channel.id);
      }
    } catch (e) {
      console.error(`显示订阅失败 (${expectedKind}):`, e);
    }
  })();

  return {
    cancel: () => {
      cancelled = true;
      void closeTauriChannel(channel, 'unsubscribe_data', channel.id);
    },
  };
}

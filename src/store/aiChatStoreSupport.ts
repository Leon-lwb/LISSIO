import { transport } from '../lib/rpc';
import type { EventChannel } from '../lib/rpc/types';
import { errorText } from '../types/errors';
import type { AiChatEvent, AiTurnEvent, AiViewItem } from '../types';
import { useSettingsStore } from './settingsStore';

export function appendTextEvent(timeline: AiTurnEvent[], kind: 'text' | 'reasoning', text: string): AiTurnEvent[] {
  if (!text) return timeline;
  const last = timeline[timeline.length - 1];
  if (last?.kind === kind) {
    return [...timeline.slice(0, -1), { kind, text: last.text + text }];
  }
  return [...timeline, { kind, text }];
}

/** 从设置读取 provider 配置 (随请求传给后端, 后端不落盘) */
export function providerConfigFromSettings() {
  const ai = useSettingsStore.getState().settings.ai;
  return {
    adapter: ai.adapter,
    base_url: ai.baseUrl,
    api_key: '',
    model: ai.model,
    temperature: ai.temperature,
    max_tokens: ai.maxTokens,
  };
}

/** 命令级失败 (invoke reject 的结构化错误对象) → 本地错误条目 (kind/data 透传, 渲染时本地化) */
export function errorItemFromRejection(err: unknown): AiViewItem {
  if (err && typeof err === 'object' && 'kind' in err) {
    const e = err as { message?: string; kind?: string; data?: Record<string, string> };
    return {
      role: 'assistant',
      text: e.message ?? 'AI request failed',
      error: true,
      error_kind: e.kind,
      error_data: e.data,
    };
  }
  return { role: 'assistant', text: errorText(err), error: true };
}

/** 构造对话事件通道 — 出口不支持 AI 命令时上报一次本地失败并返回 null */
/** Build a chat event channel, reporting unsupported exits as a local failure. */
export function openChatChannel(
  onUnsupported: (err: unknown) => void
): EventChannel<AiChatEvent> | null {
  try {
    return transport.eventChannel<AiChatEvent>();
  } catch (error) {
    onUnsupported(error);
    return null;
  }
}

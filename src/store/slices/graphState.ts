import type { SpectrumResult } from '../../types';

/// 前端专用快照状态；连续数值端口由 useNumeric* Hooks 直接订阅 DataBus。
export interface GraphStateSlice {
  /// 字符串输出平面 — 由 subscribeStringOutputs 推送
  /// key: widgetId, value: portId -> string
  customTextOutputs: Record<string, Record<string, string>>;
  spectrumResults: Record<string, SpectrumResult>;
}

export function createGraphStateSlice(): GraphStateSlice {
  return {
    customTextOutputs: {},
    spectrumResults: {},
  };
}

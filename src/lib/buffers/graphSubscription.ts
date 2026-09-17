import { transport } from '../rpc';
import type { SpectrumResult } from '../../types';
import { subscribeDisplay } from './displaySubscription';

/// 频谱批次 — 与 Rust SpectrumBatch 对应
/// 30 FPS 推送, key = Fft widget id, value = 最新一次 FFT 结果
export interface SpectrumBatch {
  /// sink widget id -> 频谱结果
  spectra: Record<string, SpectrumResult>;
}

/// 订阅频谱分析结果 (30 FPS 推送)
/// batch.spectra: sinkWidgetId -> SpectrumResult
export function subscribeSpectrum(
  onEvent: (batch: SpectrumBatch) => void
): { cancel: () => void } {
  return subscribeDisplay(
    { kind: 'spectrum' },
    'spectrum',
    (spectra: Record<string, SpectrumResult>) => onEvent({ spectra }),
    { intervalMs: 33 },
  );
}

/// 设置输入控件当前值 (Knob/Slider/Button/Radio/Checkbox 拖动时调用)
export function setInputValue(widgetId: string, value: number): Promise<void> {
  return transport.call('set_input_value', { widgetId, value });
}

/// 提交 Custom widget 输出 (iframe 调用 ctx.send 后回传)
export function submitCustomOutput(
  widgetId: string,
  outputs: Record<string, number>
): Promise<void> {
  return transport.call('submit_custom_output', { widgetId, outputs });
}

/// 字符串输出快照 — 与数值输出平行的字符串平面
export interface StringOutputSnapshot {
  tick: number;
  values: Record<string, Record<string, string>>;
}

/// 订阅字符串输出快照 — 30 FPS 自适应推送
export function subscribeStringOutputs(
  onEvent: (snapshot: StringOutputSnapshot) => void
): { cancel: () => void } {
  return subscribeDisplay({ kind: 'string_outputs' }, 'string_outputs', onEvent, { intervalMs: 33 });
}

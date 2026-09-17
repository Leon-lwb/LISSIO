import { transport } from '../rpc';
import { decodeEnvelopeFrame, type WaveformEnvelopeFrame } from '../data/envelopeProtocol';

/// 订阅波形包络 (后端逐列 min/max 降采样, GPU 加速 + CPU 回退)。
///
/// 二进制 VENV 帧经显示流向导直达 (`StreamPayload::Binary` → ArrayBuffer),
/// 与 PortSamples 同样的二进制路径; 缎带绘制见 WaveformEnvelopeChart。
/// 返回取消订阅函数。
export function subscribeWaveformEnvelope(
  source: string,
  columns: number,
  onEnvelope: (frame: WaveformEnvelopeFrame) => void,
  options?: { intervalMs?: number },
): { cancel: () => void } {
  return transport.subscribe<ArrayBuffer>(
    { kind: 'waveform_envelope', source, columns },
    (buffer) => {
      try {
        onEnvelope(decodeEnvelopeFrame(buffer));
      } catch (err) {
        console.error('VENV envelope decode failed:', err);
      }
    },
    {
      intervalMs: options?.intervalMs ?? 33,
      maxItems: null,
      onError: (e) => console.error('包络订阅失败:', e),
    },
  );
}

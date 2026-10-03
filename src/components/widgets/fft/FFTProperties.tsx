// ============ FFT 频域求解器属性编辑节 ============
//
// 从 WidgetProperties 的 FftSettings 内联实现迁移至 per-kind 注册表。

import { memo } from 'react';
import type { SpectrumOutput, WindowType } from '../../../types';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { NumberField, SelectField } from '../../ui/fields';
import type { WidgetPropertiesProps } from '../registryTypes';

/// FFT 参数 — 窗口大小 / 窗函数 / 输出模式 / 采样率
export const FFTProperties = memo(function FFTProperties({ widget, update }: WidgetPropertiesProps<'FFT'>) {
  const lang = useAppStore((s) => s.lang);
  const { windowSize, hopSize, windowType, output, sampleRate } = widget.params;
  const patch = (p: Partial<typeof widget.params>) =>
    update({ kind: 'FFT', params: { ...widget.params, ...p } });
  return (
    <section className="mt-3 pt-3 border-t border-border">
      <div className="section-heading section-heading--micro mb-2">{translate('fftSettings', lang)}</div>
      <SelectField label={translate('spectrumWindowSize', lang)} value={String(windowSize)}
        options={[256, 512, 1024, 2048, 4096].map((sz) => ({ value: String(sz), label: String(sz) }))}
        onChange={(v) => patch({ windowSize: Number(v), hopSize: Number(v) / 2 })} />
      <NumberField label={translate('fftHopSize', lang)} value={hopSize}
        onCommit={(v) => { if (Number.isInteger(v) && v > 0 && v <= windowSize) { patch({ hopSize: v }); return true; } return false; }}
        error={translate('invalidStep', lang)} />
      <SelectField label={translate('spectrumWindowType', lang)} value={windowType}
        options={([
          ['Rect', 'windowRect'],
          ['Hann', 'windowHann'],
          ['Hamming', 'windowHamming'],
          ['Blackman', 'windowBlackman'],
        ] as [WindowType, string][]).map(([value, key]) => ({ value, label: translate(key, lang) }))}
        onChange={(v) => patch({ windowType: v as WindowType })} />
      <SelectField label={translate('spectrumOutputMode', lang)} value={output}
        options={([
          ['Magnitude', 'spectrumMagnitude'],
          ['Power', 'spectrumPower'],
          ['PSD', 'spectrumPSD'],
          ['Decibel', 'spectrumDecibel'],
        ] as [SpectrumOutput, string][]).map(([value, key]) => ({ value, label: translate(key, lang) }))}
        onChange={(v) => patch({ output: v as SpectrumOutput })} />
      <NumberField label={`${translate('filterSampleRate', lang)} (Hz)`} value={sampleRate}
        onCommit={(v) => { if (v > 0) { patch({ sampleRate: v }); return true; } return false; }}
        error={translate('invalidStep', lang)} />
    </section>
  );
});

// ============ 滤波器属性编辑节 ============
//
// 从 WidgetProperties 的 FilterSettings 内联实现迁移至 per-kind 注册表。

import { memo } from 'react';
import type { FilterPresetKind } from '../../../types';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { NumberField, SelectField } from '../../ui/fields';
import type { WidgetPropertiesProps } from '../registryTypes';

/// 滤波器参数 — 预设 / 截止 / 带宽 / 采样率
export const FilterProperties = memo(function FilterProperties({ widget, update }: WidgetPropertiesProps<'Filter'>) {
  const lang = useAppStore((s) => s.lang);
  const { preset, cutoff, low, high, sampleRate } = widget.params;
  const patch = (p: Partial<typeof widget.params>) =>
    update({ kind: 'Filter', params: { ...widget.params, ...p } });
  return (
    <section className="mt-3 pt-3 border-t border-border">
      <div className="section-heading section-heading--micro mb-2">{translate('filterSettings', lang)}</div>
      <SelectField label={translate('filterPreset', lang)} value={preset}
        options={([
          ['Lowpass', 'filterLowpass'],
          ['Highpass', 'filterHighpass'],
          ['Bandpass', 'filterBandpass'],
          ['Bandstop', 'filterBandstop'],
        ] as [FilterPresetKind, string][]).map(([value, key]) => ({ value, label: translate(key, lang) }))}
        onChange={(v) => patch({ preset: v as FilterPresetKind })} />
      {(preset === 'Lowpass' || preset === 'Highpass') && (
        <NumberField label={`${translate('filterCutoff', lang)} (Hz)`} value={cutoff}
          onCommit={(v) => { if (v > 0) { patch({ cutoff: v }); return true; } return false; }}
          error={translate('invalidStep', lang)} />
      )}
      {(preset === 'Bandpass' || preset === 'Bandstop') && (
        <>
          <NumberField label={`${translate('filterLow', lang)} (Hz)`} value={low}
            onCommit={(v) => { if (v > 0) { patch({ low: v }); return true; } return false; }}
            error={translate('invalidStep', lang)} />
          <NumberField label={`${translate('filterHigh', lang)} (Hz)`} value={high}
            onCommit={(v) => { if (v > 0) { patch({ high: v }); return true; } return false; }}
            error={translate('invalidStep', lang)} />
        </>
      )}
      <NumberField label={`${translate('filterSampleRate', lang)} (Hz)`} value={sampleRate}
        onCommit={(v) => { if (v > 0) { patch({ sampleRate: v }); return true; } return false; }}
        error={translate('invalidStep', lang)} />
    </section>
  );
});

// ============ 文本下发属性 ============

import { memo } from 'react';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { NumberField, SelectField } from '../../ui/fields';
import type { WidgetPropertiesProps } from '../registryTypes';

/// 文本下发属性 — 目标串口 / 换行 / 限速 (卡片内只保留预览与发送按钮)
export const TextOutProperties = memo(function TextOutProperties({ widget, update }: WidgetPropertiesProps<'TextOut'>) {
  const lang = useAppStore((s) => s.lang);
  const nodes = useAppStore((s) => s.rfNodes);
  const { targetTransport, newline, minIntervalMs } = widget.params;
  const patch = (p: Partial<typeof widget.params>) => update({ kind: 'TextOut', params: { ...widget.params, ...p } });
  const transports = nodes.filter((n) => n.type === 'acquisition');
  return (
    <section className="mt-3 pt-3 border-t border-border">
      <div className="section-heading section-heading--micro mb-2">{translate('textOutSettings', lang)}</div>
      <SelectField label={translate('textOutTarget', lang)} value={targetTransport}
        options={[
          { value: '', label: translate('textOutNoTarget', lang) },
          ...transports.map((n) => ({
            value: n.id,
            label: typeof n.data?.label === 'string' && n.data.label ? n.data.label : n.id,
          })),
        ]}
        onChange={(v) => patch({ targetTransport: v })} />
      <SelectField label={translate('textOutNewline', lang)} value={newline}
        options={([
          ['none', 'textOutNlNone'],
          ['lf', 'textOutNlLf'],
          ['crlf', 'textOutNlCrlf'],
          ['cr', 'textOutNlCr'],
        ] as [typeof newline, string][]).map(([value, key]) => ({ value, label: translate(key, lang) }))}
        onChange={(v) => patch({ newline: v as typeof newline })} />
      <NumberField label={`${translate('textOutInterval', lang)} (ms)`} value={minIntervalMs}
        onCommit={(v) => { if (v >= 0) { patch({ minIntervalMs: Math.round(v) }); return true; } return false; }}
        error={translate('invalidStep', lang)} />
    </section>
  );
});

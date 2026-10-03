// ============ 图像控件属性编辑节 ============
//
// 宽/高 (最小 16px) + 像素格式。

import { memo } from 'react';
import type { ImageConfig } from '../../../types';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { NumberField, SelectField } from '../../ui/fields';
import type { WidgetPropertiesProps } from '../registryTypes';

/// 图像属性 — 尺寸 + 像素格式
export const ImageProperties = memo(function ImageProperties({ widget, update }: WidgetPropertiesProps<'Image'>) {
  const lang = useAppStore((s) => s.lang);
  const { width, height, format } = widget.params;
  const patch = (p: Partial<typeof widget.params>) =>
    update({ kind: 'Image', params: { ...widget.params, ...p } });
  return (
    <>
      <NumberField label={translate('imageWidth', lang)} value={width}
        onCommit={(v) => {
          const next = Math.round(v);
          if (next < 16) return false;
          patch({ width: next });
          return true;
        }}
        error={translate('invalidRange', lang)} />
      <NumberField label={translate('imageHeight', lang)} value={height}
        onCommit={(v) => {
          const next = Math.round(v);
          if (next < 16) return false;
          patch({ height: next });
          return true;
        }}
        error={translate('invalidRange', lang)} />
      <SelectField label={translate('imageFormat', lang)} value={format}
        options={([
          ['rgb888', 'formatRgb888'],
          ['rgb565', 'formatRgb565'],
          ['gray8', 'formatGray8'],
        ] as [ImageConfig['format'], string][]).map(([value, key]) => ({ value, label: translate(key, lang) }))}
        onChange={(v) => patch({ format: v as ImageConfig['format'] })} />
    </>
  );
});

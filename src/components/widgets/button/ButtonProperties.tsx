// ============ 按钮属性 ============

import { memo } from 'react';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { NumberField } from '../../ui/fields';
import { BindingSection } from '../shared/BindingSection';
import type { WidgetPropertiesProps } from '../registryTypes';

/// 按钮属性 — 按下/释放值 + 传输绑定
export const ButtonProperties = memo(function ButtonProperties({ widget, update }: WidgetPropertiesProps<'Button'>) {
  const lang = useAppStore((s) => s.lang);
  const patch = (p: Partial<typeof widget.params>) => update({ kind: 'Button', params: { ...widget.params, ...p } });
  return (
    <>
      <NumberField label={translate('press', lang)} value={widget.params.pressValue}
        onCommit={(pressValue) => { patch({ pressValue }); return true; }} />
      <NumberField label={translate('release', lang)} value={widget.params.releaseValue}
        onCommit={(releaseValue) => { patch({ releaseValue }); return true; }} />
      <BindingSection widget={widget} update={update} />
    </>
  );
});

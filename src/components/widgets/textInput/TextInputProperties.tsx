// ============ 文本输入属性 ============

import { memo } from 'react';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { TextField } from '../../ui/fields';
import type { WidgetPropertiesProps } from '../registryTypes';

/// 文本输入属性 — placeholder 提示文本
export const TextInputProperties = memo(function TextInputProperties({ widget, update }: WidgetPropertiesProps<'TextInput'>) {
  const lang = useAppStore((s) => s.lang);
  const patch = (p: Partial<typeof widget.params>) => update({ kind: 'TextInput', params: { ...widget.params, ...p } });
  return (
    <TextField label={translate('textInputPlaceholder', lang)} value={widget.params.placeholder} onCommit={(placeholder) => patch({ placeholder })} />
  );
});

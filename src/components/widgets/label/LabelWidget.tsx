// ============ 标签控件 ============
//
// 纯内容组件 — 卡片 chrome (节点框/端口/删除按钮) 由 WidgetNode 提供。

import { memo } from 'react';
import type { WidgetConfig } from '../../../types';
import { useNumericInput } from '../../../lib/hooks/useNumericPort';
import { NumericPortStatus } from '../shared/NumericPortStatus';

interface LabelProps {
  widget: Extract<WidgetConfig, { kind: 'Label' }>;
}

/// 标签控件 — 显示通道实时值或固定文本
export const Label = memo(function Label({ widget }: LabelProps) {
  const { text } = widget.params;
  const input = useNumericInput(widget.params.id, 'value');
  const display = input.latest ? `${text}: ${input.latest.value.toFixed(3)}` : text;

  return (
    <>
      <div className="text-xs text-text-secondary uppercase tracking-[0.3px]">Label</div>
      <div className="text-xl font-semibold text-text-bright font-mono text-center">{display}</div>
      <div className="text-center"><NumericPortStatus state={input} /></div>
    </>
  );
});

import { memo } from 'react';
import type { WidgetConfig } from '../../../types';
import { useNumericInput } from '../../../lib/hooks/useNumericPort';
import { NumericPortStatus } from '../shared/NumericPortStatus';

interface LEDProps {
  widget: Extract<WidgetConfig, { kind: 'LED' }>;
}

/// LED 指示灯 — 输入值 >= threshold 显示 ON 颜色, 否则 OFF
/// 数据源: value 输入边 (后端图输出)
export const LED = memo(function LED({ widget }: LEDProps) {
  const { threshold, on_color, off_color } = widget.params;
  const input = useNumericInput(widget.params.id, 'value');
  const value = input.latest?.value ?? 0;

  const isOn = value >= threshold;
  const color = isOn ? on_color : off_color;

  return (
    <div className="flex flex-col items-center gap-1 py-1.5">
      <div
        className={`w-7 h-7 rounded-full border-2 border-[#1e1e1e] transition-[background,box-shadow] ${isOn ? 'animate-led-pulse' : ''}`}
        style={{
          background: color,
          boxShadow: isOn ? `0 0 14px ${color}, 0 0 4px ${color}` : 'none',
        }}
      />
      <div className="text-[10px] font-bold text-text-secondary tracking-[0.5px]">{isOn ? 'ON' : 'OFF'}</div>
      <div className="font-mono text-[10px] text-text-secondary">{value.toFixed(3)}</div>
      <NumericPortStatus state={input} />
    </div>
  );
});

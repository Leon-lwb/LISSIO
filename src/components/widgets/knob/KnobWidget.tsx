import { memo, useCallback, useEffect, useRef } from 'react';
import { NUMERIC_CONTROL_BEHAVIOR, useNumericControl } from '../../../lib/interaction/useNumericControl';
import type { WidgetConfig } from '../../../types';
import { useAppStore } from '../../../store/appStore';
import { snapControlValue } from '../../../lib/utils/numericControl';
import { sendBindingValue } from '../shared/binding';
import { NumericValueInput } from '../shared/NumericValueInput';

interface KnobProps {
  widget: Extract<WidgetConfig, { kind: 'Knob' }>;
}

/// 旋钮控件 — 拖拽/滚轮/键盘调值, 数值框精确输入
export const Knob = memo(function Knob({ widget }: KnobProps) {
  const { label, min, max, step, binding, id } = widget.params;
  const preview = useAppStore((s) => s.inputPreviewValues[id]);
  const previewInputValue = useAppStore((s) => s.previewInputValue);
  const commitInputValue = useAppStore((s) => s.commitInputValue);
  const setInputValue = useAppStore((s) => s.setInputValue);
  const value = preview ?? widget.params.value;
  const valueRef = useRef(value);
  const knobRef = useRef<HTMLDivElement>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { setInputValue(id, widget.params.value); }, [id, widget.params.value, setInputValue]);

  const previewValue = useCallback((next: number) => {
    previewInputValue(id, snapControlValue(next, { min, max, step }));
  }, [id, max, min, previewInputValue, step]);

  const commitValue = useCallback((next = valueRef.current) => {
    const normalized = snapControlValue(next, { min, max, step });
    commitInputValue(id, normalized);
    sendBindingValue(binding, normalized);
  }, [binding, commitInputValue, id, max, min, step]);

  // 垂直拖拽调值: 按下瞬间的取值是基准, 拖过 120px 走完整个量程; 抬起时提交
  const dialHandlers = useNumericControl<number>({
    baseline: () => valueRef.current,
    onTravel: (upwardPx, startValue) => {
      previewValue(startValue + (upwardPx / NUMERIC_CONTROL_BEHAVIOR.knobPxPerFullRange) * (max - min));
    },
    onEnd: () => commitValue(),
  });

  useEffect(() => {
    const element = knobRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY < 0 ? 1 : -1;
      const next = snapControlValue(valueRef.current + direction * step, { min, max, step });
      previewInputValue(id, next);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => commitValue(next), 180);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, [commitValue, id, max, min, previewInputValue, step]);

  const angle = ((value - min) / (max - min)) * 270 - 135;

  return (
    <div className="nodrag nowheel flex flex-col items-center gap-1.5">
        <div
          ref={knobRef}
          className="knob-dial nodrag nowheel"
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          onPointerDown={dialHandlers.onPointerDown}
          onPointerMove={dialHandlers.onPointerMove}
          onPointerUp={dialHandlers.onPointerUp}
          onPointerCancel={dialHandlers.onPointerCancel}
          onKeyDown={(event) => {
            event.stopPropagation();
            let next: number | null = null;
            if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = valueRef.current + step;
            if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = valueRef.current - step;
            if (event.key === 'Home') next = min;
            if (event.key === 'End') next = max;
            if (next !== null) {
              event.preventDefault();
              previewValue(next);
            }
          }}
          onKeyUp={(event) => {
            if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
              event.stopPropagation();
              commitValue();
            }
          }}
        >
          <div className="knob-indicator-line" style={{ transform: `translateX(-50%) rotate(${angle}deg)` }} />
        </div>
        <NumericValueInput value={value} min={min} max={max} step={step} onPreview={previewValue} onCommit={commitValue} />
    </div>
  );
});

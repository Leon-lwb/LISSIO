//! 垂直拖拽调值的指针手势内核。
//!
//! 两个数值控件 (离散档位旋钮与连续量程旋钮) 各自写过同一套内核: 按下时捕获指针、
//! 记下起始 Y 与按下瞬间的基准值, 移动时把"向上的位移"交给调用方换算, 抬起或取消时
//! 释放捕获并通知结束。**换算成什么值、什么时候提交, 是各控件自己的事**, 留在调用方。
//!
//! 捕获指针之后, 指针移出元素、甚至移出窗口, 事件仍投递到捕获目标 —— 手势不会因为
//! 指针滑出去而中断, 也不需要为此挂窗口级监听器。
//!
//! 移动时按 `pointerId` 比对: 多指同时按在同一个旋钮上时, 只有发起手势的那根手指能
//! 改变取值, 否则另一根手指的位移会以第一根的起始位置为基准换算, 数值会跳。

import { useCallback, useRef } from 'react';

/// 手势共有的位移量 —— 两个控件的换算比例都在这里, 调用方不再各写一份字面量。
export const NUMERIC_CONTROL_BEHAVIOR = Object.freeze({
  /// 离散档位旋钮: 每移动这么多像素换一档
  stepKnobPxPerDetent: 12,
  /// 连续量程旋钮: 拖过这么多像素走完整个量程 (min → max)
  knobPxPerFullRange: 120,
});

export interface NumericControlOptions<T> {
  /// 禁用时完全忽略指针输入: 按下不捕获, 移动不回传
  disabled?: boolean;
  /// 按下时阻止默认行为 (避免开始文本选择 / 原生拖拽)
  preventDefaultOnPress?: boolean;
  /// 按下瞬间的基准值 —— 由调用方决定取什么 (档位索引 / 当前取值)
  baseline: () => T;
  /// 向上的位移 (px, 向上为正) 与按下瞬间的基准值
  onTravel: (upwardPx: number, baseline: T) => void;
  /// 手势结束 (抬起或取消) — 连续量程旋钮在这里提交取值
  onEnd?: (baseline: T) => void;
}

export interface NumericControlHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
}

interface ActivePress<T> {
  pointerId: number;
  startY: number;
  baseline: T;
}

/// jsdom 尚未实现指针捕获, 组件测试里拿不到这几个方法; 真机上它们始终存在。
function capturePointer(target: HTMLElement, pointerId: number): void {
  if (typeof target.setPointerCapture === 'function') target.setPointerCapture(pointerId);
}

function releasePointer(target: HTMLElement, pointerId: number): void {
  if (typeof target.hasPointerCapture !== 'function') return;
  if (target.hasPointerCapture(pointerId) && typeof target.releasePointerCapture === 'function') {
    target.releasePointerCapture(pointerId);
  }
}

export function useNumericControl<T>({
  disabled = false,
  preventDefaultOnPress = false,
  baseline,
  onTravel,
  onEnd,
}: NumericControlOptions<T>): NumericControlHandlers {
  const pressRef = useRef<ActivePress<T> | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (disabled) return;
      if (preventDefaultOnPress) event.preventDefault();
      event.stopPropagation();
      capturePointer(event.currentTarget, event.pointerId);
      pressRef.current = { pointerId: event.pointerId, startY: event.clientY, baseline: baseline() };
    },
    [baseline, disabled, preventDefaultOnPress]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const press = pressRef.current;
      if (press?.pointerId !== event.pointerId || disabled) return;
      onTravel(press.startY - event.clientY, press.baseline);
    },
    [disabled, onTravel]
  );

  /// 抬起与取消共用: 只有发起手势的那根指针能结束它, 基准值随本次手势一起消费掉。
  const finish = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const press = pressRef.current;
      if (press?.pointerId !== event.pointerId) return;
      pressRef.current = null;
      releasePointer(event.currentTarget, event.pointerId);
      onEnd?.(press.baseline);
    },
    [onEnd]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
  };
}

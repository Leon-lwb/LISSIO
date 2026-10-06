//! 按索引错峰的进场延迟。
//!
//! 一次挂载十几行内容时, 观众读到的是"闪了一下"而不是"内容到齐了" —— 同一帧里
//! 同时开始又同时结束的一组动画, 感知上只是一次闪烁, 而不是一次到达。把这一帧
//! 摊成几十毫秒里的连续到达, 观众才会把它读成"内容正在到齐"。
//!
//! 延迟必须封顶。线性累加会让长列表的末尾在视觉上还完全没动, 而那时用户已经读
//! 完了前面几行 —— 迟钝比齐飞更糟。

import { useCallback } from 'react';
import { motionIsReduced } from '../utils/reducedMotion';

/** 相邻两项之间的间隔 (ms)。 */
export const STAGGER_STEP_MS = 18;

/** 累加延迟的上限 (ms) — 越过这个位置的所有项一起进场。 */
export const STAGGER_CAP_MS = 180;

export interface StaggerOptions {
  /** 相邻项间隔, 默认 `STAGGER_STEP_MS`。 */
  stepMs?: number;
  /** 累加上限, 默认 `STAGGER_CAP_MS`。 */
  capMs?: number;
}

/**
 * 第 `index` 项的进场延迟, 单位 ms。
 *
 * 低动画偏好下返回 0。那时的令牌时长本身已被压成 1ms, 错峰只会留下一串空白帧而
 * 什么也没发生, 所以退化要退得比"更快"更彻底。
 */
export function staggerDelayMs(index: number, options: StaggerOptions = {}): number {
  if (motionIsReduced()) return 0;
  const step = Math.max(options.stepMs ?? STAGGER_STEP_MS, 0);
  const cap = Math.max(options.capMs ?? STAGGER_CAP_MS, 0);
  const position = Number.isFinite(index) ? Math.max(Math.trunc(index), 0) : 0;
  return Math.min(position * step, cap);
}

/**
 * 错峰延迟解析器 —— 返回一个按索引取延迟的函数。
 *
 * 整个列表共用同一个解析器, 这样"第几项"在所有行里是同一个口径; 函数身份稳定,
 * 可以直接传给 memo 化的行组件而不触发重渲染。
 *
 * 索引方向由调用方决定。对话气泡这类尾部锚定的列表会反向传入, 让级联从视线所在
 * 的一端开始。
 */
export function useStaggerEntrance(options: StaggerOptions = {}): (index: number) => number {
  const { stepMs, capMs } = options;
  return useCallback(
    (index: number) => staggerDelayMs(index, { stepMs, capMs }),
    [stepMs, capMs]
  );
}
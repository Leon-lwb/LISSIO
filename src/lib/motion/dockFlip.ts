//! 面板组换边时的 FLIP 接入点。
//!
//! 机制在 `./flipReorder`, 这里只负责把"什么算换边"这一句话固定下来: 触发条件是
//! 各面板占用哪条 dock 边, 不含面板自身的显隐 —— 显隐改变的是宽度, 已由
//! `docked-panel.css` 的 flex-grow 过渡负责。

import { useFlipReorder } from './flipReorder';
import type { RefObject } from 'react';

/**
 * `trigger` 必须编码面板组的**顺序** —— 每块面板占哪条边 —— 不含其他。
 */
export function useDockReorder(
  container: RefObject<HTMLElement | null>,
  trigger: string
): void {
  useFlipReorder(container, trigger, { keyAttribute: 'data-flip-key', family: 'spatial' });
}
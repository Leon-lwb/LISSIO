//! 面板组几何变化的 FLIP 接入点。
//!
//! 机制在 `./flipReorder`, 这里只负责两件事: 把"什么算换边"这一句话固定下来,
//! 以及**按变化的原因选时序** —— 面板组里会触发 FLIP 的变化有两种, 它们的物理性质
//! 完全不同, 此前共用一份时序, 于是开合也被按迁移来播。

import { useFlipReorder } from './flipReorder';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motionSpringFor, reflowSpring, type Spring } from './motionConfig';

/**
 * `layoutKey` 必须编码面板组的**顺序** —— 各面板占哪条 dock 边 —— 不含其他;
 * `sizeEpoch` 是宽度提交计数器, 每次开合各加一。
 *
 * 两者合成 FLIP 的触发条件, 但含义不同, 所以时序也必须分开:
 *
 * - **换边** (`layoutKey` 变了): 面板真的搬到了另一个位置, 到位后沉降一点是弹性,
 *   读 `spatial/in`。
 * - **开合** (`sizeEpoch` 加一而 `layoutKey` 未变): 面板组没动过, 只是某一块面板的
 *   宽度变了, 相邻面板的位置是被**别人的缺席或 presence 顶上去**的。它们既没有来源
 *   也没有动量, 于是越过槽位再荡回来只会读成渲染故障 —— 让位那份临界阻尼的时序
 *   (`reflowSpring`) 正是为此准备的, 而且它更短: 观众已经看清内容去了哪里, 动画
 *   还在收, 迟钝比回弹更糟。
 */
export function useDockReorder(
  container: RefObject<HTMLElement | null>,
  layoutKey: string,
  sizeEpoch: number
): void {
  const migrating = useRef(false);
  const previousKey = useRef<string | null>(null);

  // 必须声明在 `useFlipReorder` 之前 —— 同一次提交里 layout effect 按声明顺序执行,
  // 而时序要由这一遍的结论决定。在渲染期比较会在 StrictMode 的第二次渲染里把
  // "换过边" 读成"没换", 因为上一次渲染已经把这个 ref 写掉了。
  useLayoutEffect(() => {
    migrating.current = previousKey.current !== null && previousKey.current !== layoutKey;
    previousKey.current = layoutKey;
  });

  useFlipReorder(container, `${layoutKey}#${sizeEpoch}`, {
    keyAttribute: 'data-flip-key',
    family: 'spatial',
    spring: (distance: number) => dockYieldSpring(migrating.current, distance),
  });
}

/**
 * 面板组一次 FLIP 该读哪份时序。
 *
 * 导出成纯函数是为了能被单独断言: 迁移与让位的区别不在毫秒数上, 而在**过冲** ——
 * 让位越过槽位再荡回来是故障。所以测试钉的是阻尼比, 不是时长。
 */
export function dockYieldSpring(migrating: boolean, distancePx: number): Spring {
  return migrating ? motionSpringFor('spatial', 'in', distancePx) : reflowSpring(distancePx);
}
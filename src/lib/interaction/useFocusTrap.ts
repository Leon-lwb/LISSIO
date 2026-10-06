//! 模态浮层的焦点隔离 —— 绑定见 `focusTrap.ts` (判定逻辑与 React 无关)。

import { useEffect, type RefObject } from 'react';
import { focusInto, trapTabKey } from './focusTrap';

export interface FocusTrapOptions {
  /** 期望的初始焦点落点 (如设置面板的搜索框)。不给则取第一个可聚焦元素。 */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * 把焦点关在 `ref` 指向的子树内, 并在失活时归还给打开它的元素。
 *
 * `active` 为假时**什么都不做**: 关闭态不装监听、不动焦点。这一点是必须的 ——
 * 保活期间浮层仍然挂在 DOM 里 (见 `lib/motion/retention.tsx`), 若按"是否挂载"
 * 判断, 关闭后的浮层会继续劫持 Tab 键, 还会把焦点从触发按钮上抢走。
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  { initialFocus }: FocusTrapOptions = {}
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;

    // 打开它的那个元素 —— 通常是触发按钮。不记住它, 关闭后焦点会掉回 <body>,
    // 键盘用户需要从页面开头重新 Tab 一遍。
    const restore =
      document.activeElement instanceof HTMLElement && !root.contains(document.activeElement)
        ? document.activeElement
        : null;

    // 焦点已经在卡片里就不动它: 调用方可能自己指定了落点, 抢过来会让那次聚焦白做。
    if (!root.contains(document.activeElement)) focusInto(root, initialFocus?.current ?? null);

    const onKeyDown = (event: KeyboardEvent) => {
      trapTabKey(root, event);
    };
    // 监听挂在卡片上而不是 document: 监听面越小, 越不会在另一层浮层打开时误判,
    // 嵌套浮层也会天然按"由内向外"的顺序处理。
    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('keydown', onKeyDown);
      if (restore?.isConnected) restore.focus({ preventScroll: true });
    };
  }, [ref, active, initialFocus]);
}

//! Escape 绑定 —— 次序与判定见 `dismissStack.ts`。

import { useEffect, useRef } from 'react';
import { pushDismissHandler } from './dismissStack';

/**
 * 在 `active` 期间把"用户请求关闭"接到退避栈的最内层。
 *
 * 走 `window` 而不是 React 的 `onKeyDown`: 焦点常常在浮层内的输入框里, 而输入框
 * 可能自行处理并 `stopPropagation` Escape (搜索框用 Escape 清空自己), 于是焦点
 * 路径会决定关闭行为 —— 同一层浮层, 焦点在按钮上能关, 在搜索框里就不能关。
 * 栈由窗口直接驱动, 不受焦点位置影响; 搜索框那种"有内容时先清空"的语义仍然
 * 成立, 因为它的 `stopPropagation` 会让事件根本到不了窗口。
 *
 * `depth` 由 `DialogOverlay` 按嵌套层数给出。
 */
export function useDismissOnEscape(
  active: boolean,
  onDismiss?: () => void,
  depth = 0
): void {
  // 回调每次渲染都是新的; 放进依赖会让监听器每次渲染都重装一遍, 而重装会改变
  // 它在栈里的位置 —— 越浅的层越该靠后, 反复重排会让次序失去意义。
  const handler = useRef(onDismiss);
  handler.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    return pushDismissHandler(() => handler.current?.(), depth);
  }, [active, depth]);
}

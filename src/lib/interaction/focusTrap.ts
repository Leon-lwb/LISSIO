//! 模态浮层的焦点隔离。
//!
//! 浮层声明了 `aria-modal="true"`, 等于向辅助技术承诺"浮层之外的内容此刻不可用"。
//! 但没有对应的键盘行为时, 这个承诺是假的: 按 Tab 焦点会继续走到浮层背后的工具栏
//! 上, 屏幕上却只有一个卡片。声明与行为不一致比不声明更糟 —— 依赖辅助技术的用户
//! 会以为已经走到浮层末尾, 实际上已经在操作背后的界面。
//!
//! 所以这里做两件事: 把 Tab 循环关在卡片内, 关闭后把焦点还给打开它的那个元素
//! (通常是触发按钮, 否则焦点会掉回 `<body>`, 键盘用户需要从头 Tab 一遍)。
//!
//! 判定逻辑与 React 无关, 单独放在这里以便直接测; 绑定见 `useFocusTrap.ts`。

/** 可聚焦元素的统一口径, 与浏览器默认的 Tab 顺序保持大体一致。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'audio[controls]',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 判断元素此刻是否真的能被聚焦。
 *
 * `checkVisibility` 缺失时不做过滤: jsdom 既没有实现它也没有布局
 * (`getClientRects()` 恒为空), 用布局做判据会让测试里所有元素都被判为不可见,
 * 于是测试只能测一个空列表。真实浏览器都有这个 API, 过滤照常生效。
 */
function isVisible(element: HTMLElement): boolean {
  const probe = element as HTMLElement & {
    checkVisibility?: (options?: { checkVisibilityCSS?: boolean }) => boolean;
  };
  if (typeof probe.checkVisibility !== 'function') return true;
  return probe.checkVisibility({ checkVisibilityCSS: true });
}

/** 按文档顺序取出 `root` 内当前可聚焦的元素, 跳过 inert 与不可见节点。 */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.closest('[inert]') && isVisible(element)
  );
}

/**
 * 算出 Tab / Shift+Tab 的下一个落点, 在首尾之间回绕。
 *
 * 返回 `null` 表示没有可聚焦的候选 (空卡片、全部禁用), 调用方应把焦点留给卡片
 * 自身而不是让浏览器继续往外走 —— 那正是本条要防的事。
 *
 * `active` 不在列表里时按方向落到端点: 焦点可能停在卡片容器或已被移除的节点上,
 * 此时"从头开始"比"原地不动"更接近用户预期。
 */
export function resolveFocusStep(
  elements: readonly HTMLElement[],
  active: Element | null,
  backward: boolean
): HTMLElement | null {
  if (elements.length === 0) return null;
  const index = active === null ? -1 : elements.indexOf(active as HTMLElement);
  if (index === -1) return backward ? elements[elements.length - 1] : elements[0];
  const next = backward ? index - 1 : index + 1;
  if (next < 0) return elements[elements.length - 1];
  if (next >= elements.length) return elements[0];
  return elements[next];
}

/**
 * 处理一次 Tab 按键, 返回是否已接管 (接管即已 `preventDefault`)。
 *
 * 只有一个可聚焦元素时也要接管: 否则 Tab 会离开卡片, 而不变量是"焦点不出去"。
 * 一个都没有时同样接管, 把焦点按在卡片上, 等有内容可聚焦再交还。
 *
 * 已被接管的事件直接跳过: 键事件从焦点元素向外冒泡, 嵌套浮层时内层先看到它。
 * 内层接管后外层若再算一遍, 会按外层的候选集把焦点从内层**搬到外层**, 用户按
 * 一下 Tab 就被弹出当前浮层。`defaultPrevented` 正好是"内层已经处理过"的信号,
 * 不必用 `stopPropagation` —— 那会连带掐掉 React 自己的委托监听。
 */
export function trapTabKey(root: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab' || event.defaultPrevented) return false;
  event.preventDefault();
  const elements = focusableWithin(root);
  if (elements.length === 0) return true;

  const target = resolveFocusStep(elements, event.target as Element | null, event.shiftKey);
  if (target === null) return true;
  target.focus();
  return true;
}

/**
 * 把焦点移进卡片。
 *
 * `preferred` 给了就用它 (调用方明确的落点, 如设置面板的搜索框), 否则用第一个
 * 可聚焦元素。都没有时聚焦卡片自身, 这样 Escape 与后续 Tab 仍有一个明确的起点。
 *
 * `preventScroll` 是必要的: 卡片刚插入时浏览器会把它滚进视口, 与浮层的进场动画
 * 抢同一帧。
 */
export function focusInto(root: HTMLElement, preferred?: HTMLElement | null): void {
  const first = focusableWithin(root)[0];
  const target = preferred && root.contains(preferred) ? preferred : first;
  if (target) {
    target.focus({ preventScroll: true });
    return;
  }
  // 卡片自身可能还没有 tabindex, 补一个 -1: 焦点需要一个落点, 但这张卡片不该
  // 因此进入页面的常规 Tab 序列。
  if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
  root.focus({ preventScroll: true });
}

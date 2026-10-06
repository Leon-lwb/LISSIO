import type { KeyboardEvent } from 'react';

/** Maps the standard keyboard activation keys to an element's click handler. */
export function activateOnKeyboard(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.currentTarget.click();
}

/// 会自己消费按键的文本输入类控件。
///
/// `select` 也算在内: 下拉框收着方向键与字母键做选项跳转, 也会自己处理 Ctrl+A。
/// **漏掉它的代价是真实的**: 列表上的 Ctrl+A 会连"全选下拉项"一起抢过来, 变成选中
/// 整个列表 —— 用户以为在操作下拉框, 结果列表被全选。
const TEXT_ENTRY_TAGS = new Set(['input', 'textarea', 'select']);

/**
 * 判断事件目标是不是"正在接收文本输入"的元素。
 *
 * 用于快捷键与右键菜单的分流: 焦点在输入框里时, 浏览器与控件自身的按键语义优先,
 * 全局快捷键要让路。`isContentEditable` 覆盖富文本编辑器 —— 它不是任何一个 tag。
 *
 * 传入 `EventTarget | null` 而不是 `HTMLElement`: 调用方拿到的常常是
 * `event.target` 的原始类型, 这里统一做收窄, 免得每个调用点各写一次 `instanceof`。
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // `=== true` 而非直接 `|| target.isContentEditable`: 该属性在 jsdom 里对未设置
  // 该特性的元素返回 `undefined`, 直接或运算会让本函数"声明 boolean 却返回
  // undefined"。调用点拿它做判断时结果一样, 但返回值不该说谎。
  return TEXT_ENTRY_TAGS.has(target.tagName.toLowerCase()) || target.isContentEditable === true;
}

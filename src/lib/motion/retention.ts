//! 保活作用域 —— "退场播完之前不许卸载"的跨组件实现。
//!
//! `usePresence` 管得住**一个**元素: 它自己知道动画什么时候结束。但浮层不是一个
//! 元素 —— 遮罩、卡片各自是一段动画, 它们的时长由各自的弹簧决定 (卡片要走 10px,
//! 遮罩原地淡出), 谁先结束并不固定。任何"外层按自己的动画卸载"的写法都会按某个
//! 具体数值切掉内层的最后几帧, 而且改一次行程就会复发。
//!
//! 所以卸载权不交给计时, 而是交给登记: 还在动的元素向最近的 `RetentionScope`
//! 领一张票, 播完还回去; 作用域只在**没人持票且自己没打开**时才卸载。这样
//! "谁最后结束谁决定"不再写死, 嵌套几层都成立。
//!
//! 与 `usePresence` 的分工: `usePresence` 回答"这个元素此刻还要不要渲染",
//! 本模块回答"这棵子树此刻还要不要挂载"。两者用同一个 `onExitComplete` 时刻衔接。
//!
//! 用法:
//!   <RetentionScope open={isOpen}>…浮层…</RetentionScope>
//!   // 内部每个自己播动画的元素:
//!   useRetention(usePresence(ref, { visible: isOpen, variant: 'surface' }));
//!
//! 组件在 `RetentionScope.tsx`, 本文件只放上下文与 hook —— `react-refresh` 要求
//! 一个文件要么只导出组件, 要么只导出非组件。

import { createContext, useContext, useEffect, useRef } from 'react';

export interface Retention {
  /** 登记一次"还没播完", 返回凭据。 */
  hold(): symbol;
  /** 归还凭据。重复归还无副作用。 */
  release(ticket: symbol): void;
}

export const RetentionContext = createContext<Retention | null>(null);

/**
 * 声明"我还在动"。
 *
 * `busy` 通常直接来自 `usePresence` 的返回值 —— 它已经包含了"`visible` 为真或
 * 离场尚未结束"的判定, 所以调用方不需要自己判断动画状态。
 */
export function useRetention(busy: boolean): void {
  const scope = useContext(RetentionContext);
  useEffect(() => {
    if (!scope || !busy) return;
    const ticket = scope.hold();
    return () => scope.release(ticket);
  }, [scope, busy]);
}

/**
 * 退场期间沿用的最后一份数据。
 *
 * 关闭一个浮层通常同时做两件事: 目标状态变假, 以及把承载内容的数据清空 (清空
 * 选中项、把表单重置为空、删掉正在编辑的对象)。但保活意味着节点还要在屏幕上留
 * 到离场播完 —— 此时内容已经没了, 用户看到的是一个空壳滑出去, 或者表单突然变白。
 *
 * 所以内容也不能立刻清: `value` 还在就用它, 变空则沿用上一份非空值。等作用域
 * 真的卸载, 这份记忆跟着组件一起消失, 不会跨次污染下一次打开。
 *
 * 只处理 `null` / `undefined` —— 空字符串、0 这些是**真实内容**, 不该被当成"已清空"
 * 而换成旧值。
 */
export function useExitSnapshot<T>(value: T | null | undefined): T | null {
  const held = useRef<T | null>(value ?? null);
  if (value != null) held.current = value;
  return value ?? held.current;
}

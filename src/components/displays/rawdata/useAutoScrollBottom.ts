// ============ RawData 平滑自动滚动 ============
//
// 自动滚动开启且用户未上滚时, 新数据帧到来后平滑追赶到底部:
// rAF 指数逼近 (每帧走剩余距离的固定比例, 约 150-250ms 收敛), 动画期间持续
// 重算目标 — 高频数据帧只维持一个循环, 不会堆积。
// 防滞后: 剩余距离超过 2 屏时瞬间跳转, 不做无限追赶。
// 用户接管: 动画期间滚动位置偏离程序化写入值 (拖滚动条/滚轮/触摸) 立即取消
// 动画并按既有 <30px 视为在底部 的语义归属 userScrolledRef。
// prefers-reduced-motion: 回退为瞬时跳底。

import { useCallback, useEffect, useRef } from 'react';

/// 距底部不足该值视为仍在底部 (与旧版判定一致)
const AT_BOTTOM_PX = 30;
/// 每帧追赶剩余距离的比例 (0.35 → 约 5-8 帧收敛)
const CATCH_UP_FACTOR = 0.35;
/// 剩余距离超过 clientHeight 的该倍数时直接跳底
const SNAP_DISTANCE_FACTOR = 2;

export interface ScrollTarget {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isAtBottom(el: ScrollTarget): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX;
}

export interface AutoScrollBottomControl {
  /// Header 自动滚动按钮的激活态依据 (用户上滚后熄灭)
  userScrolledRef: React.MutableRefObject<boolean>;
  /// 数据帧到来时调用: 必要时启动/维持追底动画
  scheduleToBottom: () => void;
  /// 滚动容器 onScroll — 归属用户滚动 / 中断动画
  handleScroll: () => void;
  /// 用户主动回到底部语义: 清除上滚标记并停掉动画 (清空数据/切通道/点自动滚动按钮)
  resetUserScroll: () => void;
}

/// getEl 返回当前通道对应的滚动容器 (字节/数值/字符串三容器二选一)
export function useAutoScrollBottom(
  enabled: boolean,
  getEl: () => ScrollTarget | null
): AutoScrollBottomControl {
  const userScrolledRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const animatingRef = useRef(false);
  // 最近一次程序化写入的 scrollTop — 动画期间 scroll 事件偏差超容差 = 用户接管
  const lastProgrammaticRef = useRef(0);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      animatingRef.current = false;
    }
  }, [enabled]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    animatingRef.current = false;
  }, []);

  useEffect(() => stopLoop, [stopLoop]);

  const snapTo = useCallback((el: ScrollTarget, target: number) => {
    lastProgrammaticRef.current = target;
    el.scrollTop = target;
  }, []);

  const step = useCallback(() => {
    rafRef.current = null;
    const el = getEl();
    if (!el || !enabledRef.current || userScrolledRef.current) {
      animatingRef.current = false;
      return;
    }
    const target = el.scrollHeight - el.clientHeight;
    const dist = target - el.scrollTop;
    // 收敛完成 (含亚像素残留) 或距离过大: 吸附到底并结束
    if (dist <= 1 || dist > el.clientHeight * SNAP_DISTANCE_FACTOR) {
      snapTo(el, target);
      animatingRef.current = false;
      return;
    }
    const next = el.scrollTop + Math.max(1, dist * CATCH_UP_FACTOR);
    snapTo(el, next);
    rafRef.current = requestAnimationFrame(step);
  }, [getEl, snapTo]);

  const scheduleToBottom = useCallback(() => {
    if (!enabledRef.current || userScrolledRef.current) return;
    const el = getEl();
    if (!el) return;
    const target = el.scrollHeight - el.clientHeight;
    if (target - el.scrollTop <= 0) return;
    if (prefersReducedMotion()) {
      stopLoop();
      snapTo(el, target);
      return;
    }
    // 动画已在跑: 每帧会重算目标, 无需重复启动
    if (animatingRef.current) return;
    animatingRef.current = true;
    rafRef.current = requestAnimationFrame(step);
  }, [getEl, snapTo, step, stopLoop]);

  const handleScroll = useCallback(() => {
    const el = getEl();
    if (!el) return;
    if (animatingRef.current) {
      // 自身写入的 scroll 事件偏差在容差内; 超出 = 用户正在接管
      if (Math.abs(el.scrollTop - lastProgrammaticRef.current) > 1) {
        stopLoop();
        userScrolledRef.current = !isAtBottom(el);
      }
      return;
    }
    userScrolledRef.current = !isAtBottom(el);
  }, [getEl, stopLoop]);

  const resetUserScroll = useCallback(() => {
    stopLoop();
    userScrolledRef.current = false;
  }, [stopLoop]);

  return { userScrolledRef, scheduleToBottom, handleScroll, resetUserScroll };
}

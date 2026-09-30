// ============ RawData 平滑自动滚动 ============
//
// 自动滚动开启且用户未上滚时, 新数据帧到来后平滑追赶到底部:
// rAF 指数逼近 (每帧走剩余距离的固定比例, 约 150-250ms 收敛), 动画期间持续
// 重算目标 — 高频数据帧只维持一个循环, 不会堆积。
// 跟随过程始终逐帧追赶, 不做整屏跳变 (整屏跳底会让每次刷新都替换可见内容,
// 看起来就是画面闪烁); 只有落后到追赶已无意义的距离 (长时间上滚后回到实时)
// 才瞬时跳底, 见 SNAP_DISTANCE_PX。
// 用户接管: 滚轮/触摸输入本身即视为接管 (高频追底每帧都在写位置, 只比位置区分不了
// 用户滚动与自身写入), 动画立即取消; 位置明显不属于任何一次自身写入时同样归属用户。
// 接管后按既有 <30px 视为在底部 的语义写入 userScrolledRef。
// 脱离状态 (detached) 同时以 state 暴露, 供视口右下角"回到最新"按钮显示。
// prefers-reduced-motion: 回退为瞬时跳底。

import { useCallback, useEffect, useRef, useState } from 'react';

/// 距底部不足该值视为仍在底部 (与旧版判定一致)
const AT_BOTTOM_PX = 30;
/// 每帧追赶剩余距离的比例 (0.35 → 约 5-8 帧收敛)
const CATCH_UP_FACTOR = 0.35;
/// 落后超过该像素时直接跳底 (不再逐帧追赶)。
///
/// 这个阈值**不是**"两屏"这类视口相关值: 流式跟随时, 每批数据都会把视口推离最新,
/// 追赶速度 (剩余距离 × CATCH_UP_FACTOR) 越大追得越快, 故落后距离稳定在
/// `每帧新增像素 / CATCH_UP_FACTOR` 量级 —— 数据率高时轻易超过两屏。若按"两屏"
/// 跳底, 每次刷新都会整屏替换可见内容 (视口一帧内平移一两屏), 看起来就是画面
/// 反复闪烁、行内容逐屏跳动。
///
/// 因此只在"追赶已无意义"的场景瞬时跳底: 用户长时间上滚后重新回到实时 (落后距离
/// 可达整个环形缓冲), 此时逐帧逼近反而是无谓的长时间快速滚动。流式数据造成的落后
/// 远低于该阈值, 一律走连续追赶, 画面平滑滚动而不是整屏跳变。
const SNAP_DISTANCE_PX = 20_000;
/// 程序化写入位置的历史长度 — 覆盖 scroll 事件的派发滞后 (WebKit 上可达数帧)
const WRITE_HISTORY = 8;

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
  /// 已脱离最新数据的响应式副本 — 供"回到最新"按钮显示 (ref 本身不触发重渲染,
  /// 数据停流时按钮会来不及消失)
  detached: boolean;
  /// 用户已主动上滚离开最新 (滚轮上滚/触摸拖动/滚动条上拖) — 响应式。
  /// 与 `detached` 的区别: `detached` 是"视口当前不在底部"的瞬时状态 (高速流下
  /// 追赶过程中长期为真), 本标记只在用户**朝最新之外**滚动时置位, 并在回到底部
  /// 或主动跳最新时清除 —— 列表面板的"上滚暂停工作区"以它为准, 否则用户往下滚
  /// 回实时的动作也会被当成上滚。
  userScrolledUp: boolean;
  /// 数据帧到来时调用: 必要时启动/维持追底动画
  scheduleToBottom: () => void;
  /// 滚动容器 onScroll — 归属用户滚动 / 中断动画
  handleScroll: () => void;
  /// 用户滚动输入 (滚轮/触摸) — 位置比较无法区分用户滚动与自身写入 (自身每帧都在写,
  /// 且 scroll 事件异步派发), 故以输入事件本身为准停掉追底。
  /// `awayFromLatest` = 输入方向朝最新之外 (上滚): 随后的 scroll 事件据此归属用户。
  handleUserScrollIntent: (awayFromLatest: boolean) => void;
  /// 用户主动回到底部语义: 清除上滚标记并停掉动画 (清空数据/切通道/点自动滚动按钮)
  resetUserScroll: () => void;
  /// "回到最新": 清除脱离标记并瞬时跳到最新数据 (距离可能有数十万行, 不做平滑动画)
  jumpToLatest: () => void;
}

/// getEl 返回当前通道对应的滚动容器 (字节/数值/字符串三容器二选一)
export function useAutoScrollBottom(
  enabled: boolean,
  getEl: () => ScrollTarget | null
): AutoScrollBottomControl {
  const userScrolledRef = useRef(false);
  // 脱离状态的响应式镜像 — 与 userScrolledRef 同步写入, 保证两者语义永不分离
  const [detached, setDetached] = useState(false);
  const rafRef = useRef<number | null>(null);
  const animatingRef = useRef(false);
  // 最近几次程序化写入的 scrollTop — scroll 事件在 WebKit 上异步派发, 可能在数帧后
  // 才带着"当时"的位置到达; 只比对最近一次写入会把这种滞后事件误判成用户接管,
  // 跟随会在半途停住 (面板停在落后位置不再追底)。写入历史让滞后事件对应回自己。
  const writeHistoryRef = useRef<number[]>([]);
  // 用户已发出"离开最新"的滚动输入 (上滚) — 追底动画立即让位, 随后的 scroll 事件
  // 按是否在底部给出脱离状态; 回到底部/主动复位/重新开启跟随时清除
  const userIntentRef = useRef(false);
  /// 响应式镜像 — 驱动"上滚暂停工作区" (ref 自身不触发重渲染)
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  /// 上一次观察到的滚动位置 — 用于识别"位置变小 = 用户朝最新之外滚动" (拖滚动条);
  /// null = 尚未观察到 (首个事件只记录基线, 不下方向判断)
  const lastScrollTopRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);

  /// 同步"用户上滚"标记的 ref 与 state (同值 setState 被 React 忽略, 无额外渲染)
  const markUserScrolledUp = useCallback((value: boolean) => {
    if (userIntentRef.current === value) return;
    userIntentRef.current = value;
    setUserScrolledUp(value);
  }, []);

  /// 同步 ref 与 state: 同值 setState 会被 React 忽略, 故高频 scroll 事件无额外渲染
  const markUserScroll = useCallback((value: boolean) => {
    userScrolledRef.current = value;
    setDetached(value);
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      animatingRef.current = false;
    } else {
      // 重新开启跟随: 之前的上滚输入不再约束追底
      markUserScrolledUp(false);
    }
  }, [enabled, markUserScrolledUp]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    animatingRef.current = false;
  }, []);

  useEffect(() => stopLoop, [stopLoop]);

  const snapTo = useCallback((el: ScrollTarget, target: number) => {
    const history = writeHistoryRef.current;
    history.push(target);
    if (history.length > WRITE_HISTORY) history.shift();
    el.scrollTop = target;
  }, []);

  /// 当前滚动位置是否来自本 hook 的写入 (含滞后若干帧才到达的事件)
  const isOwnWrite = useCallback((scrollTop: number) => {
    return writeHistoryRef.current.some((value) => Math.abs(value - scrollTop) <= 1);
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
    // 收敛完成 (含亚像素残留) 或落后到追赶无意义: 吸附到底并结束;
    // 其余情况统一逐帧追赶 —— 不做整屏跳变 (见 SNAP_DISTANCE_PX 说明)
    if (dist <= 1 || dist > SNAP_DISTANCE_PX) {
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
    if (target - el.scrollTop <= 0) {
      // 没有落后 (含内容不足一屏): 上滚输入并未真的离开最新, 不必再约束追底
      markUserScrolledUp(false);
      return;
    }
    // 用户上滚输入已接管: 不再把视口拽回最新 (脱离状态由 scroll 事件给出)
    if (userIntentRef.current) return;
    if (prefersReducedMotion()) {
      stopLoop();
      snapTo(el, target);
      return;
    }
    // 动画已在跑: 每帧会重算目标, 无需重复启动
    if (animatingRef.current) return;
    animatingRef.current = true;
    rafRef.current = requestAnimationFrame(step);
  }, [getEl, snapTo, step, stopLoop, markUserScrolledUp]);

  const handleUserScrollIntent = useCallback(
    (awayFromLatest: boolean) => {
      stopLoop();
      if (!awayFromLatest) return;
      const el = getEl();
      // 没有可滚动余量: 上滚改变不了视口, 不算"离开最新"
      if (!el || el.scrollHeight - el.clientHeight <= 0) return;
      markUserScrolledUp(true);
    },
    [getEl, stopLoop, markUserScrolledUp]
  );

  const handleScroll = useCallback(() => {
    const el = getEl();
    if (!el) return;
    const previousScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    // 已在底部 (含 <AT_BOTTOM_PX 容差): 无论事件来自谁, 都恢复"跟随最新"语义。
    // 注意这里只恢复视口跟随, 不清除"用户上滚"标记 —— 暂停后的恢复是显式动作
    // (回到最新/重新开启自动滚动/从状态栏恢复), 不因视口恰好滑到底部而自动启动。
    if (isAtBottom(el)) {
      stopLoop();
      markUserScroll(false);
      return;
    }
    // 用户已明确上滚: 直接归属用户, 不再与自身写入比较 (自身每帧都在写)
    if (userIntentRef.current) {
      markUserScroll(true);
      return;
    }
    // 位置变小 = 用户朝最新之外滚动 (拖滚动条不产生滚轮事件, 只能按方向识别)
    const movedAway = previousScrollTop !== null && el.scrollTop < previousScrollTop;
    if (animatingRef.current) {
      // 自身写入的滞后事件仍带着自己的历史值; 不属于任何一次写入 = 用户正在接管
      if (!isOwnWrite(el.scrollTop)) {
        stopLoop();
        if (movedAway) markUserScrolledUp(true);
        markUserScroll(true);
      }
      return;
    }
    // 动画已收敛后数据又增长: 滞后到达的自身写入事件不代表用户上滚
    if (isOwnWrite(el.scrollTop)) return;
    if (movedAway) markUserScrolledUp(true);
    markUserScroll(true);
  }, [getEl, isOwnWrite, stopLoop, markUserScroll, markUserScrolledUp]);

  const resetUserScroll = useCallback(() => {
    stopLoop();
    markUserScrolledUp(false);
    markUserScroll(false);
  }, [stopLoop, markUserScroll, markUserScrolledUp]);

  const jumpToLatest = useCallback(() => {
    stopLoop();
    markUserScrolledUp(false);
    markUserScroll(false);
    const el = getEl();
    if (!el) return;
    // 一次写完 scrollTop 而非分帧追赶: 脱离读数可能跨整个环形缓冲 (数十万行),
    // 指数逼近在途中会不断被新数据推远, 用户永远到不了最新
    snapTo(el, Math.max(0, el.scrollHeight - el.clientHeight));
  }, [getEl, markUserScroll, markUserScrolledUp, snapTo, stopLoop]);

  return {
    userScrolledRef,
    detached,
    userScrolledUp,
    scheduleToBottom,
    handleScroll,
    handleUserScrollIntent,
    resetUserScroll,
    jumpToLatest,
  };
}

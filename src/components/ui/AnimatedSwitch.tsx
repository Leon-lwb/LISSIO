import { useEffect, useRef, type ReactNode } from 'react';
import { motionDuration, motionIsReduced, motionSpring } from '../../lib/motion';

interface AnimatedSwitchProps {
  /// 切换标识 — 值变化时播放一次转场动画 (首次挂载不播放)
  switchKey: string;
  /// 有序 key 列表 — 与 axis 配合, 按新旧位置关系决定滑入方向
  /// (横向 Tab 条传 x, 竖向 Tab 列传 y; 向右/下移动时内容从右/下方滑入)
  order?: readonly string[];
  /// 滑动轴向; 缺省时仅淡入淡出 (用于无空间顺序的模式切换)
  axis?: 'x' | 'y';
  children: ReactNode;
  className?: string;
}

/** Full-index travel. One step is subtle; crossing the whole strip is not. */
const MAX_TRAVEL = 18;
const FALLBACK_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Signed travel for a switch, in px, along the given axis.
 *
 * Direction comes from where the new key sits relative to the old one, and the
 * magnitude scales with how many positions were crossed: nudging one tab should
 * not read the same as jumping the length of the strip. Returns 0 when the two
 * keys have no spatial relationship, which degrades to a pure cross-fade.
 */
export function switchTravel(
  from: string,
  to: string,
  order: readonly string[] | undefined,
  axis: 'x' | 'y' | undefined
): number {
  if (!order || !axis) return 0;
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return 0;
  const steps = Math.abs(toIdx - fromIdx);
  const direction = toIdx > fromIdx ? 1 : -1;
  const axisFactor = axis === 'x' ? 1 : 0.6;
  return direction * axisFactor * Math.min(MAX_TRAVEL, 4 + (steps - 1) * 6);
}

/// 通用切换转场容器
/// 纯 CSS transition (transform + opacity) — 动画由合成器线程接管, 不触发任何
/// React 状态更新 / rAF 逐帧重渲染, 也不依赖 Web Animations API。
/// 在不 remount 子树的前提下播放过渡动画, 保留子组件内部状态 (如 ReactFlow 视口)
export function AnimatedSwitch({ switchKey, order, axis, children, className }: AnimatedSwitchProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prevKey = useRef(switchKey);
  // 最新 order/axis 的 ref, 避免 effect 依赖每次渲染新建的数组
  const navRef = useRef({ order, axis });
  navRef.current = { order, axis };

  useEffect(() => {
    const from = prevKey.current;
    prevKey.current = switchKey;
    if (from === switchKey) return;
    const el = ref.current;
    if (!el) return;
    if (motionIsReduced()) return;

    // 方向由新旧位置关系决定, 距离由跨越的索引数决定 —— 跳过一格和横穿整个
    // Tab 条不该是同一种幅度, 否则远距离切换会显得被"拽"过来。
    const { order: ord, axis: ax } = navRef.current;
    const travel = switchTravel(from, switchKey, ord, ax);

    // 时长与缓动都取自 content 家族的弹簧令牌, 与 CSS 其余部分同一来源;
    // 令牌尚未烘焙时退回等价的三次贝塞尔, 避免无缓动的生硬切换。
    const duration = Math.round(motionDuration('content', 'in') * 1000);
    const baked = getComputedStyle(el).getPropertyValue('--ease-content-in').trim();
    const easing = baked || FALLBACK_EASE;

    const settle = el.style;
    settle.transition = 'none';
    settle.opacity = '0';
    settle.transform = travel === 0 ? 'none' : `translate${ax === 'y' ? 'Y' : 'X'}(${travel}px)`;
    void el.offsetWidth; // 让起始态立即生效
    settle.transition = `opacity ${duration}ms ${easing}, transform ${duration}ms ${easing}`;
    settle.opacity = '1';
    settle.transform = 'none';

    // 交还合成器: 动画结束即释放, 不长期占用图层。
    const timer = window.setTimeout(() => {
      settle.transition = '';
      settle.opacity = '';
      settle.transform = '';
    }, duration);
    return () => window.clearTimeout(timer);
  }, [switchKey]);

  return (
    <div ref={ref} className={`motion-switch ${className ?? ''}`} data-motion-switch="content">
      {children}
    </div>
  );
}

/// 供测试与文档核对: content 家族入场的弹簧时长 (秒)
export const ANIMATED_SWITCH_DURATION = () => motionDuration('content', 'in');
/// 供测试与文档核对: content 家族入场的弹簧
export const ANIMATED_SWITCH_SPRING = () => motionSpring('content', 'in');
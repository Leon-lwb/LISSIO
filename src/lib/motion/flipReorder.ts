//! FLIP: 让容器内换槽位的键控子元素保持空间连续性。
//!
//! 面板组按 `order` 排序、块列表按数组顺序渲染, 两者改序时 DOM 节点都存活 —— 浏览器
//! 在第一帧就把它放进了新槽位, 缺的只是连续性。FLIP 补的正是这一点: 记住旧槽位, 把
//! 元素按偏移放回去, 再交给弹簧送到位。
//!
//! 一次测量解决三类变化, 因为对 FLIP 而言它们是同一件事 —— 只有槽位变了:
//! - **换序**: 元素换了相对顺序。
//! - **删除**: 后续元素整体前移一格。
//! - **插入**: 后续元素整体后移一格。
//! 所以退出项不需要任何额外状态, 它的缺席本身就是位移的来源。
//!
//! 两条刻意的限制:
//! - 可见性不是触发条件。显隐改变的是尺寸, 由元素自己的尺寸过渡负责; 再叠一层 FLIP
//!   会与那个过渡争夺同一批像素。
//! - 只写 `transform`。宽高只测量、不补间 —— 换槽位不改变元素尺寸, 补间尺寸等于
//!   补间一个并不存在的差异。

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { promote } from './compositor';
import { ensureSpringPlugin, springTween } from './gsapSpring';
import { motionSpringFor, type MotionFamily } from './motionConfig';
import { motionIsReduced } from './reducedMotion';

/** 默认的身份属性: 换序后仍能对上同一个元素的那个值。 */
const DEFAULT_KEY_ATTR = 'data-flip-key';

/** 小于该位移的槽位变化是布局噪声, 不是移动。 */
const MIN_TRAVEL_PX = 0.5;

/** 让飞行中的元素压过它沿途跨过的邻居。 */
const TRAVEL_Z = 2;

interface Slot {
  left: number;
  top: number;
}

interface Offset {
  x: number;
  y: number;
}

export interface FlipReorderOptions {
  /**
   * 承载身份的属性名。默认 `data-flip-key`; 已经为拖拽逻辑准备了别的标记
   * (如 `data-block-id`) 的列表直接复用那个属性, 不必再加一份。
   */
  keyAttribute?: string;
  /** 位移读哪个家族。面板组是 `spatial`, 列表行是 `content`。 */
  family?: MotionFamily;
}

function liveOffset(element: HTMLElement): Offset {
  return {
    x: Number(gsap.getProperty(element, 'x')) || 0,
    y: Number(gsap.getProperty(element, 'y')) || 0,
  };
}

/**
 * 各元素的落定槽位 —— 布局位置扣掉在途位移。
 *
 * 这个减法就是全部要点: 仍在飞行的元素报告的是它**动画中的**盒子, 拿它和落定槽位
 * 相减会凭空造出一个从未发生过的差值 (元素会朝错误的方向弹一下)。
 */
function measureSlots(elements: HTMLElement[], keyAttribute: string): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  for (const element of elements) {
    const key = element.getAttribute(keyAttribute);
    if (!key) continue;
    const rect = element.getBoundingClientRect();
    const offset = liveOffset(element);
    slots.set(key, { left: rect.left - offset.x, top: rect.top - offset.y });
  }
  return slots;
}

/**
 * 容器内换槽位时对键控子元素做 FLIP。
 *
 * `trigger` 必须只编码**顺序** —— 谁排在谁前面, 不含任何别的东西。改变元素尺寸而
 * 不改变槽位的状态不属于这里, 那由元素自身的尺寸过渡负责。
 */
export function useFlipReorder(
  container: RefObject<HTMLElement | null>,
  trigger: string,
  options: FlipReorderOptions = {}
): void {
  ensureSpringPlugin();

  const { keyAttribute = DEFAULT_KEY_ATTR, family = 'spatial' } = options;
  const attrRef = useRef(keyAttribute);
  attrRef.current = keyAttribute;
  const familyRef = useRef(family);
  familyRef.current = family;

  const slots = useRef<Map<string, Slot> | null>(null);
  const lastTrigger = useRef<string | null>(null);

  // 窗口尺寸变化会在不重渲染本子树的情况下搬动每个槽位, 于是记住的矩形变陈旧, 下一次
  // 换序会从元素从未待过的地方开始播。跟着 resize 重新测量, 让起点诚实, 又不必每次
  // 渲染都测量。
  useEffect(() => {
    const sync = () => {
      const root = container.current;
      if (!root) return;
      const attr = attrRef.current;
      slots.current = measureSlots(
        Array.from(root.querySelectorAll<HTMLElement>(`[${attr}]`)),
        attr
      );
    };
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [container]);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;

    const attr = attrRef.current;
    const elements = Array.from(root.querySelectorAll<HTMLElement>(`[${attr}]`));
    const current = measureSlots(elements, attr);

    const before = slots.current;
    const reordered = lastTrigger.current !== null && lastTrigger.current !== trigger;
    slots.current = current;
    lastTrigger.current = trigger;

    // 首遍没有可比的旧槽位; 低动画保留状态变化, 丢掉位移。
    if (!reordered || before === null || motionIsReduced()) return;

    const travelFamily = familyRef.current;
    for (const element of elements) {
      const key = element.getAttribute(attr);
      if (!key) continue;
      const from = before.get(key);
      const to = current.get(key);
      if (!from || !to) continue;

      const dx = from.left - to.left;
      const dy = from.top - to.top;
      const distance = Math.hypot(dx, dy);
      if (distance < MIN_TRAVEL_PX) continue;

      const release = promote(element);
      gsap.killTweensOf(element);
      gsap.set(element, { x: dx, y: dy, zIndex: TRAVEL_Z });
      gsap.to(element, {
        ...springTween(travelFamily, 'in', { x: 0, y: 0 }, {
          spring: motionSpringFor(travelFamily, 'in', distance),
        }),
        onComplete: () => {
          gsap.set(element, { clearProps: 'transform,zIndex' });
          release();
        },
      });
    }
  });
}
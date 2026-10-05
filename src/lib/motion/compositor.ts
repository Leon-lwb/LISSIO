//! Compositor-layer budget control.
//!
//! Promoting an element to its own layer makes animation cheap, but a promoted
//! layer costs memory and, past a certain count, makes the compositor the
//! bottleneck instead of the main thread. The usual workaround — leaving
//! `will-change` on permanently — is worse: it burns VRAM for elements that are
//! not moving and defeats the very purpose.
//!
//! So promotion is refcounted. Every animation asks for the layer it needs and
//! releases it on completion; overlapping animations share one promotion, and a
//! surface that animates repeatedly never accumulates stale hints.
//!
//! The same call also settles **who owns `transform` while the animation runs**.
//! Card surfaces carry a CSS `transition` on `transform` for their hover lift, so a
//! JS tween writing `element.style.transform` every frame has a second writer
//! chasing it: the browser then interpolates between consecutive frames instead of
//! showing them, which smooths a 150ms spring into a 300ms crawl and leaves the
//! card visibly lagging its own opacity. Two writers cannot both be right, so the
//! borrow suspends the CSS transition and gives the property back on release.
//!
//! The second job here is enforcement. `assertCompositedOnly` turns "animate only
//! transform/opacity" from a convention into a checked invariant, so a future
//! `left`/`width` tween fails a test instead of silently costing a layout per
//! frame.

/** Properties that can be animated without triggering layout or paint. */
const COMPOSITED = new Set(['transform', 'opacity']);

/**
 * Properties that are legitimately animated on user input or for non-motion
 * reasons, where a layout pass per frame is inherent to the interaction (a
 * pointer-driven resize, a scroll-follow) rather than a mistake.
 */
const INPUT_DRIVEN = new Set(['left', 'top', 'right', 'bottom', 'width', 'height']);

interface Promotion {
  count: number;
  value: string;
  /** 进入借用前的内联 `transition-property`, 归还时原样写回。 */
  transitionProperty: string;
}

/**
 * 借用期间写进内联的 `transition-property`。
 *
 * `none` 而不是"只留颜色类属性": 借用的那几百毫秒里表面本来就在动, 颜色没有理由
 * 同时过渡 —— 而列出"要保留哪些"等于把每张卡片的 transition 清单复制一份到 JS 里,
 * 卡片改样式时它会静默失真。
 */
const TRANSITION_SUSPENDED = 'none';

const promotions = new WeakMap<HTMLElement, Promotion>();

/** No-op release for a missing element, so callers need no null branch. */
function noRelease(): void {
  /* nothing to release */
}

/**
 * Request a compositor layer for `element` for the duration of one animation.
 * Returns the matching release function; calling it twice is a no-op.
 */
export function promote(
  element: HTMLElement | null,
  properties: readonly string[] = COMPOSITED_PROPS
): () => void {
  if (!element) return noRelease;
  const value = properties.join(', ');
  const existing = promotions.get(element);
  if (existing) {
    existing.count += 1;
  } else {
    promotions.set(element, {
      count: 1,
      value,
      transitionProperty: element.style.transitionProperty,
    });
    element.style.setProperty('will-change', value);
    // 借走 transform 期间 CSS 不再过渡它 —— 见文件头"一个属性只能有一个写者"。
    if (properties.includes('transform')) {
      element.style.transitionProperty = TRANSITION_SUSPENDED;
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = promotions.get(element);
    if (!current) return;
    current.count -= 1;
    if (current.count > 0) return;
    promotions.delete(element);
    element.style.removeProperty('will-change');
    element.style.transitionProperty = current.transitionProperty;
  };
}

const COMPOSITED_PROPS = ['transform', 'opacity'] as const;

/**
 * 一段动画对某个元素的借用。
 *
 * `promote()` 是引用计数的, 但引用计数只认"还了没有", 认不出"这一段被打断了"。
 * 而打断恰好是最常见的结束方式: `@gsap/react` 的 `useGSAP` 在**依赖变化**时不会调用
 * 上一次返回的 cleanup (只在卸载时调用), 于是上一段动画只能靠 `killTweensOf` 收场 ——
 * 补间被杀, `onComplete` 不触发, 那一层图层与那份 transform 所有权就永远留在元素上。
 *
 * 这个槽位把"一段动画的借用"变成可替换的一格: 新的一段进来先归还上一段, 于是无论
 * 动画是正常播完还是被下一次打断, 归还都恰好发生一次。
 */
export interface BorrowSlot {
  /** 记下这一段的归还函数, 并先归还上一段 (如果有)。 */
  take(release: () => void): void;
  /** 归还当前这一段。重复调用或空槽都是无操作。 */
  release(): void;
}

export function createBorrowSlot(): BorrowSlot {
  let owned: (() => void) | null = null;
  return {
    take(release) {
      owned?.();
      owned = release;
    },
    release() {
      const pending = owned;
      owned = null;
      pending?.();
    },
  };
}

/**
 * Report any animated property that would leave the compositor thread.
 *
 * Returns the offenders so a caller (or a test) can fail loudly. Pointer-driven
 * geometry is excused, since the layout work there is caused by the user's own
 * input rather than by the animation system.
 */
export function assertCompositedOnly(
  properties: Record<string, unknown>,
  context: { inputDriven?: boolean } = {}
): string[] {
  const offenders: string[] = [];
  for (const key of Object.keys(properties)) {
    if (COMPOSITED.has(key) || context.inputDriven) continue;
    if (INPUT_DRIVEN.has(key)) offenders.push(key);
  }
  return offenders;
}

/** Test seam: how many promotions an element currently holds. */
export function promotionCount(element: HTMLElement): number {
  return promotions.get(element)?.count ?? 0;
}
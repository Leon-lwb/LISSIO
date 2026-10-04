import { useLayoutEffect, useRef, useState } from 'react';

export interface PillRect {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

const HIDDEN: PillRect = { left: 0, top: 0, width: 0, height: 0, visible: false };

/// 滑动指示器 hook — 跟踪容器内 [data-tab-key="activeKey"] 元素的位置/尺寸
/// 容器需 position: relative; 各 Tab 项带 data-tab-key 属性
/// 每次渲染后重新测量 (Tab 重命名/增删/窗口缩放均能跟踪), 仅在矩形变化时 setState
export function useSlidingPill(activeKey: string | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = useState<PillRect>(HIDDEN);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const el =
        activeKey != null
          ? container.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(activeKey)}"]`)
          : null;
      if (!el) {
        setPill((p) => (p.visible ? HIDDEN : p));
        return;
      }
      const next: PillRect = {
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
        visible: true,
      };
      setPill((p) =>
        p.visible &&
        p.left === next.left &&
        p.top === next.top &&
        p.width === next.width &&
        p.height === next.height
          ? p
          : next
      );
    };
    update();
    // rAF 延迟: RO 回调内同步 setState 会改变布局并在同一帧再次触发 RO,
    // 导致 "ResizeObserver loop completed with undelivered notifications"
    let raf: number | null = null;
    const ro = new ResizeObserver(() => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = null;
        update();
      });
    });
    ro.observe(container);
    container.querySelectorAll<HTMLElement>('[data-tab-key]').forEach((el) => ro.observe(el));
    return () => {
      ro.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  });

  return { containerRef, pill };
}

/**
 * 把一个矩形换算成纯 `transform`。
 *
 * 元素本身按 `width`/`height` 布局在容器原点(`transform-origin: 0 0`), 因此
 * `translate` 直接落到目标位置, `scale` 把目标尺寸还原成 `rect` 的尺寸。传入
 * `rect` 自身尺寸时得到恒等变换, 传入上一个矩形时得到 FLIP 的起始姿态。
 */
export function pillTransform(rect: PillRect, width: number, height: number): string {
  const scaleX = width > 0 ? rect.width / width : 1;
  const scaleY = height > 0 ? rect.height / height : 1;
  return `translate(${rect.left}px, ${rect.top}px) scale(${scaleX}, ${scaleY})`;
}

/// 滑块本体 — 绝对定位在容器内, 只写 `transform`, 位置与尺寸变化不触发布局
/// variant: 'editor' (默认, bg-editor) | 'panel' (bg-active, 用于竖排通道 Tab)
export function SlidingPill({ pill, variant = 'editor' }: { pill: PillRect; variant?: 'editor' | 'panel' }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const settled = useRef<PillRect | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!pill.visible || pill.width <= 0 || pill.height <= 0) {
      settled.current = null;
      return;
    }
    const previous = settled.current;
    settled.current = pill;
    if (previous) {
      // 尺寸已经是目标尺寸, 所以只需把 scale 调回上一帧, 元素就"看起来"还在旧矩形。
      // 过渡必须先关掉, 再强制一次样式结算让这个姿态成为过渡起点, 否则浏览器会
      // 从上一次已合成的 transform 插值, 尺寸就会瞬间跳变而不是形变。
      el.style.transition = 'none';
      el.style.transform = pillTransform(previous, pill.width, pill.height);
      void el.offsetWidth;
    }
    el.style.transition = '';
    el.style.transform = pillTransform(pill, pill.width, pill.height);
  }, [pill]);

  if (!pill.visible) return null;
  return (
    <div
      ref={ref}
      aria-hidden
      className={`tab-sliding-pill motion-pill ${variant === 'panel' ? 'tab-sliding-pill--panel' : ''}`}
      style={{ width: pill.width, height: pill.height }}
    />
  );
}

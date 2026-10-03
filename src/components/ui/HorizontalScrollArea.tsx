import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';

interface HorizontalScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /// 滚动内容的布局类 (横向 flex、间距、内边距等)
  className?: string;
  /// 外层定位壳的布局类
  shellClassName?: string;
}

interface ScrollEdges {
  start: boolean;
  end: boolean;
}

/// 单行横向滚动区: 滚轮横移内容，并在仍可滚动的方向显示渐隐提示。
export function HorizontalScrollArea({
  children,
  className = '',
  shellClassName = '',
  ...rest
}: HorizontalScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: true });

  const updateEdges = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
    const next = {
      start: element.scrollLeft > 1,
      end: element.scrollLeft < maxScroll - 1,
    };
    setEdges((current) =>
      current.start === next.start && current.end === next.end ? current : next
    );
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;

      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1;
      const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
      const next = Math.min(maxScroll, Math.max(0, element.scrollLeft + delta * scale));
      if (next === element.scrollLeft) return;

      event.preventDefault();
      element.scrollLeft = next;
      updateEdges();
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateEdges);
    resizeObserver?.observe(element);
    // controls may appear/disappear without changing the viewport width
    const mutationObserver = new MutationObserver(updateEdges);
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    updateEdges();

    return () => {
      element.removeEventListener('wheel', handleWheel);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, [updateEdges]);

  return (
    <div className={clsx('horizontal-scroll-shell relative min-w-0', shellClassName)}>
      <div
        ref={scrollRef}
        className={clsx('horizontal-scroll-area overflow-x-auto overflow-y-hidden', className)}
        onScroll={updateEdges}
        {...rest}
      >
        {children}
      </div>
      <div
        aria-hidden
        className="horizontal-scroll-shadow horizontal-scroll-shadow-start"
        data-visible={edges.start}
      />
      <div
        aria-hidden
        className="horizontal-scroll-shadow horizontal-scroll-shadow-end"
        data-visible={edges.end}
      />
    </div>
  );
}

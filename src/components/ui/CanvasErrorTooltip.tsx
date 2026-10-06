/// 画布节点错误浮标 — 纯展示件: 收到非空 message 时在 hover 显示。
///
/// 用原生 hover state 实现 (避免引入 radix-ui)。**它不读 store**: 消息文本由调用方
/// 传入 —— 节点侧经 `useCanvasNodeError` 取 (见 `lib/hooks/`), 于是这个组件可以脱离
/// 全局状态单独渲染。展示形态是"红框 + hover 消息", 红框由调用方的节点框负责。

import { useState, type ReactNode } from 'react';

interface CanvasErrorTooltipProps {
  message: string | null;
  children: ReactNode;
}

export function CanvasErrorTooltip({ message, children }: CanvasErrorTooltipProps) {
  const [hover, setHover] = useState(false);
  if (!message) return <>{children}</>;
  return (
    <div
      className="relative h-full"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      {hover && (
        <div
          role="tooltip"
          className="absolute z-50 left -translate-x bottom-full mb-1 px-2 py-1 bg-danger-surface text-text-inverse text-xs rounded shadow-lg pointer-events-none max-w-[260px] whitespace-normal leading-tight"
        >
          {message}
        </div>
      )}
    </div>
  );
}

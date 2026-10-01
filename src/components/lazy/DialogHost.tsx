//! 弹窗宿主 — 按需挂载的懒加载弹窗统一渲染点。
//!
//! 语义: `{ open && <Suspense>…</Suspense> }` — **打开时才触发 chunk 加载**,
//! 启动时 7 个弹窗互不预取, 避免多个 lazy chunk 并发加载导致全屏遮罩闪烁。
//! 弹窗本体 (含 `isOpen` 内部门控) 只声明一次, 由 `App` 传表驱动, 不再重复
//! 7 段结构相同的 Suspense JSX。
//!
//! fallback 统一为 overlay 遮罩 (`SuspenseFallback overlay`): 弹窗都是全屏层,
//! 加载中保持视觉连续, 与既有弹窗遮罩一致。

import { Suspense, type ReactNode } from 'react';
import { SuspenseFallback } from '../ui/SuspenseFallback';

export interface DialogDescriptor {
  /// 稳定 key — React 列表与调试定位用 (如 'settings' / 'about')。
  key: string;
  /// 是否打开 (打开才挂载, 关闭即卸载并释放 chunk 引用)。
  open: boolean;
  /// 已声明好的弹窗元素 (通常是 `lazyComponents` 里的 `Lazy*` 组件)。
  element: ReactNode;
}

/** 弹窗宿主 — 只渲染 `open` 的条目, 各自独立 Suspense 边界。 */
export function DialogHost({ dialogs }: { dialogs: readonly DialogDescriptor[] }) {
  return (
    <>
      {dialogs.map(({ key, open, element }) =>
        open ? (
          <Suspense key={key} fallback={<SuspenseFallback overlay />}>
            {element}
          </Suspense>
        ) : null
      )}
    </>
  );
}

//! 弹窗宿主 — 按需挂载的懒加载弹窗统一渲染点。
//!
//! 语义: **首次打开才触发 chunk 加载** —— 关闭态返回 `null`, 启动时 7 个弹窗互不
//! 预取, 避免多个 lazy chunk 并发加载导致全屏遮罩闪烁。打开过之后保持挂载, 于是
//! 关闭时弹窗自己播得完离场弹簧; 真正决定"什么时候可以卸载"的是弹窗内部的
//! `RetentionScope`, 不是这里 (见 `lib/motion/retention.tsx`)。
//!
//! 卸载时机不能由宿主猜: 遮罩与卡片各自是一段动画, 时长由各自的弹簧决定, 谁先
//! 结束并不固定。任何按固定时长或按 `open` 直接卸载的写法都会切掉最后几帧, 而且
//! 改一次行程就会复发。
//!
//! fallback 统一为 overlay 遮罩 (`SuspenseFallback overlay`): 弹窗都是全屏层,
//! 加载中保持视觉连续, 与既有弹窗遮罩一致。

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { RetentionScope } from '../../lib/motion';
import { SuspenseFallback } from '../ui/SuspenseFallback';

export interface DialogDescriptor {
  /// 稳定 key — React 列表与调试定位用 (如 'settings' / 'about')。
  key: string;
  /// 是否打开。首次为真时才挂载 (触发 chunk 加载), 之后保持挂载以便播完离场。
  open: boolean;
  /// 已声明好的弹窗元素 (通常是 `lazyComponents` 里的 `Lazy*` 组件)。
  element: ReactNode;
}

/** 弹窗宿主 — 只挂载打开过的条目, 各自独立 Suspense 边界。 */
export function DialogHost({ dialogs }: { dialogs: readonly DialogDescriptor[] }) {
  return (
    <>
      {dialogs.map(({ key, open, element }) => (
        <DialogSlot key={key} open={open} element={element} />
      ))}
    </>
  );
}

function DialogSlot({ open, element }: { open: boolean; element: ReactNode }) {
  // 打开过就记住: 关闭后仍然要渲染, 否则没有节点可以播离场动画。
  const [armed, setArmed] = useState(open);

  useEffect(() => {
    if (open) setArmed(true);
  }, [open]);

  if (!armed) return null;

  return (
    <Suspense fallback={<SuspenseFallback overlay />}>
      <RetentionScope open={open}>{element}</RetentionScope>
    </Suspense>
  );
}

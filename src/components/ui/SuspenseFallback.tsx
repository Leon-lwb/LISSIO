//! 共享 Suspense 加载占位 — React.lazy 懒加载模块加载期间的统一视觉
//!
//! - 默认: 填满父容器 (数据 Tab 切换等场景), 复用 Lissio 利萨茹加载标记
//! - overlay: 弹窗场景, 使用全屏遮罩 (fixed inset-0 + dialog-overlay), 与现有弹窗遮罩一致
import { LissajousMark } from '../brand/LissajousMark';

interface SuspenseFallbackProps {
  /** 作为弹窗加载占位时使用全屏遮罩 */
  overlay?: boolean;
}

export function SuspenseFallback({ overlay = false }: SuspenseFallbackProps) {
  const spinner = (
    <div className="flex items-center justify-center" role="status" aria-label="Loading">
      <LissajousMark size={overlay ? 52 : 30} />
    </div>
  );

  if (overlay) {
    return (
      <div className="fixed inset-0 dialog-overlay z-modal flex items-center justify-center">
        <div className="module-card bg-bg-sidebar px-6 py-5 flex items-center justify-center">
          {spinner}
        </div>
      </div>
    );
  }

  return (
    <div className="module-card h-full w-full bg-bg-sidebar flex items-center justify-center">
      {spinner}
    </div>
  );
}

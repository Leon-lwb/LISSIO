import { useRef, type ReactNode } from 'react';
import { useContentSwitch } from '../../lib/motion';
import { switchTravel } from './tabTravel';

interface AnimatedSwitchProps {
  /// 切换标识 — 值变化时播放一次转场动画 (首次挂载不播放)
  switchKey: string;
  /// 有序 key 列表 — 与 axis 配合, 按新旧位置关系决定滑入方向
  /// (横向 Tab 条传 x, 竖向 Tab 列传 y; 向右/下移动时内容从右/下方滑入)
  order?: readonly string[];
  /// 滑动轴向; 缺省时立即切换, 不在磨砂表面祖先上淡入淡出
  axis?: 'x' | 'y';
  children: ReactNode;
  className?: string;
}

/// 通用切换转场容器
/// 动效层通过 Web Animations 驱动 transform, 不在磨砂表面的祖先上写 opacity。
/// 在不 remount 子树的前提下播放过渡动画, 保留子组件内部状态 (如 ReactFlow 视口)
export function AnimatedSwitch({ switchKey, order, axis, children, className }: AnimatedSwitchProps) {
  const ref = useRef<HTMLDivElement>(null);
  useContentSwitch(ref, switchKey, previous => {
    const travel = switchTravel(previous, switchKey, order, axis);
    return { x: axis === 'x' ? travel : 0, y: axis === 'y' ? travel : 0 };
  });

  return (
    <div ref={ref} className={`motion-switch ${className ?? ''}`}>
      {children}
    </div>
  );
}

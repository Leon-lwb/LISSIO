import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { endGhostRelease, subscribeGhost, type GhostState } from '../../lib/interaction/dockDrag';
import {
  createBorrowSlot,
  GHOST_RELEASE_SCALE,
  GHOST_REST_OPACITY,
  motionIsReduced,
  motionSpringFor,
  planRelease,
  promote,
  springTween,
} from '../../lib/motion';

/// 拖拽幽灵 — 以指针为中心的半透明标签, 替代 HTML5 DnD 的拖拽快照
/// pointer-events: none — 不参与命中测试, 不遮挡下方投放区
///
/// 位置走 transform 而不是 left/top: 拖拽期间每帧都要改坐标, 落在 left/top 上
/// 就是每帧一次布局。松手时同一批属性交给弹簧补间, 合成器图层由 promote/release
/// 按动画期借还。
export function DockDragGhost() {
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const ownRef = useRef<HTMLDivElement>(null);
  // 见 `BorrowSlot`: 上一次松手动画被 `killTweensOf` 打断时不会自己收尾。
  const borrow = useRef(createBorrowSlot());

  useEffect(() => subscribeGhost(setGhost), []);

  useGSAP(
    () => {
      const element = ownRef.current;
      if (!ghost || !element) return;

      // 上一段动画可能还在飞 (松手后立刻开始下一次拖拽), 死掉它再摆位 —— 并替它归还。
      gsap.killTweensOf(element);
      borrow.current.release();

      // 释放计划由速度在此推导: 交互层只交出松手速度, 前冲距离/初速度/时长都是
      // 弹簧令牌的函数, 因此只有效果层认识它们 (见 lib/motion/release.ts)。
      const plan = ghost.velocity ? planRelease(ghost.velocity.x, ghost.velocity.y) : null;
      if (!plan || motionIsReduced()) {
        gsap.set(element, {
          x: ghost.x,
          y: ghost.y,
          xPercent: -50,
          yPercent: -50,
          scale: 1,
          opacity: GHOST_REST_OPACITY,
        });
        // 没有补间可等, 幽灵的寿命就到此为止 (放稳了 / 低动画偏好)。
        endGhostRelease();
        return;
      }

      borrow.current.take(promote(element));
      gsap.to(element, {
        ...springTween('spatial', 'out', {
          x: ghost.x + plan.dx,
          y: ghost.y + plan.dy,
          scale: GHOST_RELEASE_SCALE,
          opacity: 0,
        }, {
          // 按前冲距离解算, 狠甩比轻甩滑得久; 初速度让幽灵接着手指的速度起步。
          spring: motionSpringFor('spatial', 'out', Math.hypot(plan.dx, plan.dy)),
          initialVelocity: plan.initialVelocity,
        }),
        // 补间走完即幽灵寿终 —— 存活时长就是这一步, 不存在第二个要手工对齐的数字。
        onComplete: () => {
          borrow.current.release();
          endGhostRelease();
        },
      });
    },
    { scope: ownRef, dependencies: [ghost] }
  );

  if (!ghost) return null;
  return (
    <div
      ref={ownRef}
      aria-hidden
      className="fixed z-[150] pointer-events-none flex items-center gap-1.5 px-2.5 py-1 popover-surface text-text-primary text-xs whitespace-nowrap"
    >
      {ghost.label}
    </div>
  );
}
//! 松手时的动量交接。
//!
//! 拖拽结束有两种读法, 必须分开: 放稳了 (把面板推到槽位再松开) 和甩出去 (还带着
//! 速度就松手)。前者不该有惯性 —— 幽灵在原地放大淡出即可; 后者应该让幽灵带着手指
//! 的速度继续走一段, 否则"甩"和"放"在视觉上完全一样, 界面读不出手势的轻重。
//!
//! 前冲距离与松手速度成正比, 所以轻甩几乎不动、狠甩能跨出明显一段 —— 和真实物体
//! 在桌面上滑行一致。速度以初速度交给求解器 (见 `springAtWithVelocity`), 所以幽灵
//! 是"接着手指的速度走", 而不是从静止重新起步。
//!
//! 初速度钳在无过冲边界以内: 越过落点再荡回来的离场读起来是渲染故障, 不是物理。
//! 因此这里能拿到的读感是"甩得越狠滑得越远", 而不是"甩得越猛起步越快" —— 后者与
//! "不过冲"在线性系统里互斥 (航程正比于初速度时初速度必然是常数), 不取。

import { motionSpring, motionSpringFor } from './motionConfig';
import { springNoOvershootVelocity, springSettleTime } from './spring';

/** 低于此速度视为"放稳了"而非"甩出去" (px/s)。 */
export const MOMENTUM_FLOOR_PX_S = 500;

/** 无过冲边界的余量 —— 恰好落在临界点上仍可能有过冲的极小尾巴。 */
const NO_OVERSHOOT_MARGIN = 0.9;

/** 前冲距离的兜底上限 (px) —— 只在荒唐的甩动速度下才生效。 */
const COAST_MAX_PX = 120;

/** 幽灵静止时的不透明度。 */
export const GHOST_REST_OPACITY = 0.9;

/** 松手时放大到的倍数。 */
export const GHOST_RELEASE_SCALE = 1.3;

export interface ReleasePlan {
  /** 前冲位移 (px), 沿松手速度方向。没有动量时为 0。 */
  dx: number;
  dy: number;
  /** 交给弹簧的初速度, 按前冲总距离归一化 (每秒走过全程的比例)。 */
  initialVelocity: number;
  /** 幽灵必须存活的时长 (ms) —— 弹簧的沉降时间。 */
  durationMs: number;
}

/**
 * 把松手速度换算成幽灵的释放动画。
 *
 * 返回的时长是幽灵存活的唯一权威: `dockDrag` 用它安排清除, 组件用它驱动补间,
 * 两边不再各自写死一个数字 (从前 `RELEASE_MS` 与组件的 CSS transition 是两份
 * 必须手工对齐的副本)。
 */
export function planRelease(velocityX: number, velocityY: number): ReleasePlan {
  const vx = Number.isFinite(velocityX) ? velocityX : 0;
  const vy = Number.isFinite(velocityY) ? velocityY : 0;
  const speed = Math.hypot(vx, vy);
  const atRest = motionSpring('spatial', 'out');
  const duration = (spring: ReturnType<typeof motionSpring>) => springSettleTime(spring) * 1000;

  if (speed < MOMENTUM_FLOOR_PX_S) {
    return { dx: 0, dy: 0, initialVelocity: 0, durationMs: duration(atRest) };
  }

  // 先用零距离的弹簧定出无过冲初速度, 再由它反推这段速度该滑多远 —— 航程因此完全
  // 由令牌推导, 而不是另填一个常数。
  const bound = springNoOvershootVelocity(atRest) * NO_OVERSHOOT_MARGIN;
  const coast = Math.min(speed / bound, COAST_MAX_PX);
  const spring = motionSpringFor('spatial', 'out', coast);

  return {
    dx: (vx / speed) * coast,
    dy: (vy / speed) * coast,
    // 航程封顶生效时 speed/coast 会小于边界, 取小值只会更保守。
    initialVelocity: Math.min(
      speed / coast,
      springNoOvershootVelocity(spring) * NO_OVERSHOOT_MARGIN
    ),
    durationMs: duration(spring),
  };
}
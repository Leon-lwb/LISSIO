import { afterEach, describe, expect, it } from 'vitest';
import { motionSpeed, reflowSpring, REFLOW_TIMING, timingAt } from '../motionConfig';
import { springFromTiming, springSettleTime } from '../spring';

/**
 * 让位时序的独立于家族之处。
 *
 * 让位是一次家族体系表达不了的运动: 它不新来也不离开, 只是相邻几行之间挪一格。家族按
 * "移动了屏幕多少"排序, 而这里需要区分的是"这是一个物体到达, 还是周围让开"。所以它
 * 是一份具名时序加一个解析器, 而不是新家族。
 */
function setSpeed(value: string) {
  document.documentElement.dataset.motionSpeed = value;
}

afterEach(() => {
  delete document.documentElement.dataset.motionSpeed;
});

describe('reflowSpring', () => {
  it('is critically damped, so a yielding row never sails past its slot', () => {
    expect(REFLOW_TIMING.bounce).toBe(0);
    // 20px 是最常见的一格让位; 取它作为代表。
    expect(springSettleTime(reflowSpring(20))).toBeGreaterThan(0);
  });

  it('still stretches with distance, so a big gap is not read at a single row’s pace', () => {
    // 删掉一个展开的块会让位距离远大于一格, 那次让位不该和删掉一个收起的块一样快。
    expect(springSettleTime(reflowSpring(400))).toBeGreaterThan(
      springSettleTime(reflowSpring(20))
    );
  });

  it('honours the animation speed setting like every other token', () => {
    // 这是最容易在后续重构里丢掉的性质: 让位时序不是家族表里的一格, 所以不会自动
    // 跟着 SPEED_SCALE 走 —— 它必须自己走。一旦有人把它内联成常数, "动画速度"设置
    // 就会对三处块列表失效, 而这条断言会拦住。
    setSpeed('fast');
    const fast = springSettleTime(reflowSpring(20));
    setSpeed('standard');
    const standard = springSettleTime(reflowSpring(20));
    setSpeed('relaxed');
    const relaxed = springSettleTime(reflowSpring(20));

    expect(motionSpeed()).toBe('relaxed');
    expect(fast).toBeLessThan(standard);
    expect(standard).toBeLessThan(relaxed);
  });

  it('stays clear of the content family it sits beside', () => {
    // 让位刻意比家族离场更快 —— 事件更小。若有人把 REFLOW_TIMING 调回家族那一档,
    // 让位会重新变得拖沓, 这条断言是那道闸。
    setSpeed('standard');
    const yielding = springSettleTime(reflowSpring(20));
    const departure = springSettleTime(springFromTiming(timingAt('content', 'out', 'standard')));
    expect(yielding).toBeLessThan(departure);
  });
});
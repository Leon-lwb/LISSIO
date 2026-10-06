import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { NUMERIC_CONTROL_BEHAVIOR, useNumericControl } from '../useNumericControl';

/// 造一个带指针捕获的假元素 — jsdom 没有实现 pointer capture
function fakeElement() {
  const captured = new Set<number>();
  const setPointerCapture = vi.fn((id: number) => void captured.add(id));
  const hasPointerCapture = vi.fn((id: number) => captured.has(id));
  const releasePointerCapture = vi.fn((id: number) => void captured.delete(id));
  return { setPointerCapture, hasPointerCapture, releasePointerCapture, captured };
}

type FakeEl = ReturnType<typeof fakeElement>;

function pointerEvent(el: FakeEl, pointerId: number, clientY: number) {
  return {
    pointerId,
    clientY,
    currentTarget: el,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.PointerEvent<HTMLElement>;
}

/// 同上, 但把 preventDefault / stopPropagation 的探针交出来供断言 —
/// 直接从事件对象上取方法会脱离调用者, 断言不到。
function probeableEvent(el: FakeEl, pointerId: number, clientY: number) {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const event = { pointerId, clientY, currentTarget: el, preventDefault, stopPropagation } as unknown as React.PointerEvent<HTMLElement>;
  return { event, preventDefault, stopPropagation };
}

/// 按下 → 移动 → 抬起, 全程走同一根指针
function setup(options?: Partial<Parameters<typeof useNumericControl<number>>[0]>) {
  const onTravel = vi.fn();
  const onEnd = vi.fn();
  const hook = renderHook(() =>
    useNumericControl<number>({
      baseline: () => 100,
      onTravel,
      onEnd,
      ...options,
    })
  );
  return { hook, onTravel, onEnd, el: fakeElement() };
}

describe('useNumericControl', () => {
  it('按下时捕获指针并记住基准值, 移动时交出向上位移与基准', () => {
    const { hook, onTravel, el } = setup();
    act(() => hook.result.current.onPointerDown(pointerEvent(el, 1, 500)));
    expect(el.captured.has(1)).toBe(true);

    act(() => hook.result.current.onPointerMove(pointerEvent(el, 1, 450)));
    // 向上移动 50px (clientY 变小)
    expect(onTravel).toHaveBeenCalledWith(50, 100);

    act(() => hook.result.current.onPointerMove(pointerEvent(el, 1, 530)));
    // 向下移动 30px 即向上位移为负
    expect(onTravel).toHaveBeenLastCalledWith(-30, 100);
  });

  it('抬起时释放捕获并通知结束 — 连续量程旋钮据此提交', () => {
    const { hook, onEnd, el } = setup();
    act(() => hook.result.current.onPointerDown(pointerEvent(el, 1, 500)));
    act(() => hook.result.current.onPointerUp(pointerEvent(el, 1, 400)));
    expect(el.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(el.captured.has(1)).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('取消与抬起等价 — 手指被系统抢走时同样收尾', () => {
    const { hook, onEnd, el } = setup();
    act(() => hook.result.current.onPointerDown(pointerEvent(el, 1, 500)));
    act(() => hook.result.current.onPointerCancel(pointerEvent(el, 1, 500)));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(el.captured.has(1)).toBe(false);
  });

  it('未按下时移动不产生任何回传 — 悬停过旋钮不该改值', () => {
    const { hook, onTravel, el } = setup();
    act(() => hook.result.current.onPointerMove(pointerEvent(el, 1, 100)));
    expect(onTravel).not.toHaveBeenCalled();
  });

  it('抬起后移动失效 — 手势已结束, 后续位移不再改值', () => {
    const { hook, onTravel, el } = setup();
    act(() => hook.result.current.onPointerDown(pointerEvent(el, 1, 500)));
    act(() => hook.result.current.onPointerUp(pointerEvent(el, 1, 500)));
    act(() => hook.result.current.onPointerMove(pointerEvent(el, 1, 100)));
    expect(onTravel).not.toHaveBeenCalled();
  });

  it('另一根手指的位移不生效 — 只有发起手势的指针能改值', () => {
    const { hook, onTravel, el } = setup();
    act(() => hook.result.current.onPointerDown(pointerEvent(el, 1, 500)));
    act(() => hook.result.current.onPointerMove(pointerEvent(el, 2, 100)));
    expect(onTravel).not.toHaveBeenCalled();

    // 发起手势的那根指针照常生效
    act(() => hook.result.current.onPointerMove(pointerEvent(el, 1, 450)));
    expect(onTravel).toHaveBeenCalledWith(50, 100);
  });

  it('另一根手指的抬起不结束手势', () => {
    const { hook, onEnd, el } = setup();
    act(() => hook.result.current.onPointerDown(pointerEvent(el, 1, 500)));
    act(() => hook.result.current.onPointerUp(pointerEvent(el, 2, 500)));
    expect(onEnd).not.toHaveBeenCalled();
    expect(el.captured.has(1)).toBe(true);
  });

  it('禁用时完全忽略指针输入', () => {
    const { hook, onTravel, onEnd, el } = setup({ disabled: true });
    act(() => hook.result.current.onPointerDown(pointerEvent(el, 1, 500)));
    expect(el.captured.size).toBe(0);
    act(() => hook.result.current.onPointerMove(pointerEvent(el, 1, 400)));
    expect(onTravel).not.toHaveBeenCalled();
    act(() => hook.result.current.onPointerUp(pointerEvent(el, 1, 400)));
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('每根手势各取一次基准值 — 第二次按下不会沿用上一次的基准', () => {
    let current = 100;
    const onTravel = vi.fn();
    const hook = renderHook(() => useNumericControl<number>({ baseline: () => current, onTravel }));
    const el = fakeElement();

    act(() => hook.result.current.onPointerDown(pointerEvent(el, 1, 500)));
    act(() => hook.result.current.onPointerMove(pointerEvent(el, 1, 450)));
    expect(onTravel).toHaveBeenLastCalledWith(50, 100);

    current = 250; // 期间取值被别处改了
    act(() => hook.result.current.onPointerUp(pointerEvent(el, 1, 450)));
    act(() => hook.result.current.onPointerDown(pointerEvent(el, 1, 500)));
    act(() => hook.result.current.onPointerMove(pointerEvent(el, 1, 450)));
    expect(onTravel).toHaveBeenLastCalledWith(50, 250);
  });

  it('按下时按要求阻止默认行为 (避免起手选中文本)', () => {
    const { hook, el } = setup({ preventDefaultOnPress: true });
    const { event, preventDefault, stopPropagation } = probeableEvent(el, 1, 500);
    act(() => hook.result.current.onPointerDown(event));
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('两个控件的换算比例各自成条目, 不是散落的字面量', () => {
    expect(NUMERIC_CONTROL_BEHAVIOR.stepKnobPxPerDetent).toBeGreaterThan(0);
    expect(NUMERIC_CONTROL_BEHAVIOR.knobPxPerFullRange).toBeGreaterThan(0);
    // 连续旋钮的行程比档位旋钮的一档更长 —— 反过来会让手感错乱
    expect(NUMERIC_CONTROL_BEHAVIOR.knobPxPerFullRange).toBeGreaterThan(
      NUMERIC_CONTROL_BEHAVIOR.stepKnobPxPerDetent
    );
    expect(Object.isFrozen(NUMERIC_CONTROL_BEHAVIOR)).toBe(true);
  });
});

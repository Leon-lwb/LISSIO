import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { StepKnob } from '../StepKnob';

/// jsdom 未实现指针捕获: 补上, 否则按下时就会抛错。
/// 注意 `onPointerMove` 用的是 React 事件对象, 这里只补捕获相关方法。
/// 断言时用下面这两个句柄, 不直接引用原型上的方法 (引用即脱离调用者)。
let captureSpy: Mock<(pointerId: number) => void>;
let releaseSpy: Mock<(pointerId: number) => void>;

beforeEach(() => {
  captureSpy = vi.fn<(pointerId: number) => void>();
  releaseSpy = vi.fn<(pointerId: number) => void>();
  Element.prototype.setPointerCapture = captureSpy;
  Element.prototype.releasePointerCapture = releaseSpy;
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

const STEPS = [1, 2, 5, 10, 20, 50, 100];

/// 拨盘元素 — 手势挂在这里
function dial(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.step-knob-dial');
  if (!el) throw new Error('未找到拨盘元素');
  return el as HTMLElement;
}

function setup(value = 10, extra: Partial<Parameters<typeof StepKnob>[0]> = {}) {
  const onChange = vi.fn();
  const result = render(
    <StepKnob
      value={value}
      steps={STEPS}
      onChange={onChange}
      formatValue={(v) => String(v)}
      {...extra}
    />
  );
  return { onChange, result };
}

/// 按下 → 移动 → 抬起。clientY 变小表示向上拖。
function drag(el: HTMLElement, fromY: number, toY: number, pointerId = 1) {
  fireEvent.pointerDown(el, { pointerId, clientY: fromY });
  fireEvent.pointerMove(el, { pointerId, clientY: toY });
  fireEvent.pointerUp(el, { pointerId, clientY: toY });
}

describe('StepKnob 拖拽换档', () => {
  it('向上拖满一格换一档 — 12px 一档', () => {
    const { onChange, result } = setup(10); // 索引 3
    drag(dial(result.container), 500, 488);
    expect(onChange).toHaveBeenCalledWith(20); // 索引 4
  });

  it('不足半格不换档 — 位移被四舍五入吸收', () => {
    const { onChange, result } = setup(10);
    drag(dial(result.container), 500, 495);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('相对按下瞬间的索引换算, 而不是逐个移动事件累加', () => {
    // 受控组件: 通知之后父层会带新值重渲染, 所以这里必须跟着改 value 才能暴露
    // "以最新索引为基准" 的写法 — 否则换算基准没变, 两种实现看起来一样。
    const onChange = vi.fn();
    const { rerender } = render(
      <StepKnob value={10} steps={STEPS} onChange={onChange} formatValue={(v) => String(v)} />
    );
    const el = dial(document.body);
    fireEvent.pointerDown(el, { pointerId: 1, clientY: 500 });

    fireEvent.pointerMove(el, { pointerId: 1, clientY: 488 });
    expect(onChange).toHaveBeenLastCalledWith(20); // 索引 3 → 4
    rerender(<StepKnob value={20} steps={STEPS} onChange={onChange} formatValue={(v) => String(v)} />);

    // 关键: 从按下时的索引 3 起算 24px = +2 档 → 索引 5 (50)。
    // 若以"当前"索引 4 为基准, 会算成索引 6 (100) — 手指每动一次就多跳一档。
    fireEvent.pointerMove(el, { pointerId: 1, clientY: 476 });
    expect(onChange).toHaveBeenLastCalledWith(50);
    rerender(<StepKnob value={50} steps={STEPS} onChange={onChange} formatValue={(v) => String(v)} />);

    // 拖回起点: 回到按下时的档位, 值变化, 应当通知
    fireEvent.pointerMove(el, { pointerId: 1, clientY: 500 });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('向下拖减小档位', () => {
    const { onChange, result } = setup(10); // 索引 3
    drag(dial(result.container), 500, 536); // 向下 36px = 3 档
    expect(onChange).toHaveBeenCalledWith(1); // 索引 3 - 3 = 0
  });

  it('拖出量程两端即截断, 不越界', () => {
    const { onChange, result } = setup(10);
    const el = dial(result.container);
    drag(el, 500, 100); // 向上 400px ≈ 33 档, 远超档位总数
    expect(onChange).toHaveBeenLastCalledWith(100); // 最后一档

    onChange.mockClear();
    drag(el, 500, 900); // 向下 400px
    expect(onChange).toHaveBeenLastCalledWith(1); // 第一档
  });

  it('抬起后继续移动不再改档', () => {
    const { onChange, result } = setup(10);
    const el = dial(result.container);
    fireEvent.pointerDown(el, { pointerId: 1, clientY: 500 });
    fireEvent.pointerUp(el, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(el, { pointerId: 1, clientY: 400 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('另一根手指的移动不改档 — 多指同时按在旋钮上不该跳档', () => {
    const { onChange, result } = setup(10);
    const el = dial(result.container);
    fireEvent.pointerDown(el, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(el, { pointerId: 2, clientY: 100 });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerMove(el, { pointerId: 1, clientY: 488 });
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('禁用时按下与移动都无效', () => {
    const { onChange, result } = setup(10, { disabled: true });
    drag(dial(result.container), 500, 400);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('双击回到默认档位', () => {
    const { onChange, result } = setup(10, { defaultValue: 5 });
    fireEvent.doubleClick(dial(result.container));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('双击时值已是默认值则不发通知', () => {
    const { onChange, result } = setup(5, { defaultValue: 5 });
    fireEvent.doubleClick(dial(result.container));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('禁用时双击无效', () => {
    const { onChange, result } = setup(10, { defaultValue: 5, disabled: true });
    fireEvent.doubleClick(dial(result.container));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('指针捕获后滚轮照常换档 — 原生监听器不受影响', () => {
    const { onChange, result } = setup(10);
    const el = dial(result.container);
    drag(el, 500, 488); // 先做一次手势, 确认不残留状态
    onChange.mockClear();
    // 原生非被动监听器挂在容器上, 拨盘冒泡上去; deltaY < 0 = 向上滚 = 升一档
    fireEvent.wheel(el, { deltaY: -1 });
    expect(onChange).toHaveBeenCalledWith(20); // 10 → 索引 3, 升一档 = 索引 4
  });

  it('指针离开元素后仍能用捕获完成手势 — 捕获让事件继续投递', () => {
    const { onChange, result } = setup(10);
    const el = dial(result.container);
    fireEvent.pointerDown(el, { pointerId: 1, clientY: 500 });
    expect(captureSpy).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(el, { pointerId: 1, clientY: 476 });
    fireEvent.pointerUp(el, { pointerId: 1, clientY: 476 });
    expect(releaseSpy).toHaveBeenCalledWith(1);
    expect(onChange).toHaveBeenLastCalledWith(50); // 24px 向上 = 2 档
  });
});

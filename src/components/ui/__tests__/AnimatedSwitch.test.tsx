import { renderWithI18n } from '../../../test/renderWithI18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionDuration } from '../../../lib/motion';
import { AnimatedSwitch } from '../AnimatedSwitch';
import { switchTravel } from '../tabTravel';

function stubMatchMedia(matches = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })
  );
}

describe('AnimatedSwitch', () => {
  beforeEach(() => {
    stubMatchMedia();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies a pure CSS transform/opacity transition on switchKey change without remounting', () => {
    const { container, rerender } = renderWithI18n(
      <AnimatedSwitch switchKey="a">
        <div>content</div>
      </AnimatedSwitch>
    );
    const el = container.firstElementChild as HTMLElement;
    // 首次挂载不播放动画, 无内联 transition
    expect(el.style.transition).toBe('');

    rerender(
      <AnimatedSwitch switchKey="b">
        <div>content</div>
      </AnimatedSwitch>
    );

    // 同一 DOM 节点 (不 remount 子树), 切换仅通过 CSS transition 驱动
    expect(container.firstElementChild).toBe(el);
    // 时长来自 content 家族弹簧令牌, 不写死数值以免令牌调整后失配
    const expected = `${Math.round(motionDuration('content', 'in') * 1000)}ms`;
    expect(el.style.transition).toContain(`opacity ${expected}`);
    expect(el.style.transition).toContain(`transform ${expected}`);
    expect(el.style.opacity).toBe('1');
    expect(el.style.transform).toBe('none');
    expect(el.textContent).toBe('content');
  });

  it('scales travel with the number of positions crossed', () => {
    const order = ['a', 'b', 'c', 'd', 'e', 'f'];
    // Direction follows position.
    expect(switchTravel('a', 'b', order, 'x')).toBeGreaterThan(0);
    expect(switchTravel('b', 'a', order, 'x')).toBeLessThan(0);
    // Magnitude grows with distance, and saturates rather than running away.
    expect(Math.abs(switchTravel('a', 'd', order, 'x'))).toBeGreaterThan(
      Math.abs(switchTravel('a', 'b', order, 'x'))
    );
    expect(switchTravel('a', 'e', order, 'x')).toBe(switchTravel('a', 'f', order, 'x'));
    // A vertical strip moves less than a horizontal one for the same jump.
    expect(Math.abs(switchTravel('a', 'd', order, 'y'))).toBeLessThan(
      Math.abs(switchTravel('a', 'd', order, 'x'))
    );
  });

  it('degrades to a cross-fade when there is no spatial relationship', () => {
    const order = ['a', 'b'];
    expect(switchTravel('a', 'b', undefined, 'x')).toBe(0);
    expect(switchTravel('a', 'b', order, undefined)).toBe(0);
    expect(switchTravel('a', 'missing', order, 'x')).toBe(0);
    expect(switchTravel('a', 'a', order, 'x')).toBe(0);
  });

  it('resolves the slide direction from the ordered keys', () => {
    const { container, rerender } = renderWithI18n(
      <AnimatedSwitch switchKey="a" order={['a', 'b']} axis="x">
        <div>content</div>
      </AnimatedSwitch>
    );
    const el = container.firstElementChild as HTMLElement;

    rerender(
      <AnimatedSwitch switchKey="b" order={['a', 'b']} axis="x">
        <div>content</div>
      </AnimatedSwitch>
    );
    // a → b 向右移动: 起始态 translateX(16px) 过渡到 none; 终态为静止
    expect(el.style.transform).toBe('none');
    expect(el.style.transition).toContain('transform');

    rerender(
      <AnimatedSwitch switchKey="a" order={['a', 'b']} axis="x">
        <div>content</div>
      </AnimatedSwitch>
    );
    expect(el.style.transform).toBe('none');
  });

  it('skips animation when prefers-reduced-motion is enabled', () => {
    stubMatchMedia(true);
    const { container, rerender } = renderWithI18n(
      <AnimatedSwitch switchKey="a">
        <div>content</div>
      </AnimatedSwitch>
    );
    const el = container.firstElementChild as HTMLElement;

    rerender(
      <AnimatedSwitch switchKey="b">
        <div>content</div>
      </AnimatedSwitch>
    );
    expect(el.style.transition).toBe('');
  });
});

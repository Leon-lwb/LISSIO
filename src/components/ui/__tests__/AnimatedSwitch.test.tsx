import { act } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionDuration } from '../../../lib/motion';
import { AnimatedSwitch } from '../AnimatedSwitch';
import { switchTravel } from '../tabTravel';

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
const animations: { cancel: ReturnType<typeof vi.fn>; finish: () => void }[] = [];
const animate = vi.fn(() => {
  let finish = () => undefined as void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const cancel = vi.fn();
  animations.push({ cancel, finish });
  return { finished, cancel } as unknown as Animation;
});

function stubMatchMedia(matches = false) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches, media: '', onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
    removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
}

beforeEach(() => {
  stubMatchMedia();
  animations.length = 0;
  animate.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

describe('AnimatedSwitch', () => {
  it('preserves the subtree and backdrop sampling while the browser owns completion', async () => {
    const view = (key: string) => <AnimatedSwitch switchKey={key} order={['a', 'b']} axis="x"><input defaultValue="draft" /></AnimatedSwitch>;
    const { container, rerender } = renderWithI18n(view('a'));
    const element = container.firstElementChild as HTMLElement;
    const input = element.querySelector('input')!;
    input.value = 'unsaved';
    expect(animate).not.toHaveBeenCalled();
    rerender(view('b'));
    expect(container.firstElementChild).toBe(element);
    expect(element.querySelector('input')?.value).toBe('unsaved');
    expect(animate).toHaveBeenCalledWith([
      { transform: `translate(${switchTravel('a', 'b', ['a', 'b'], 'x')}px, 0px)` },
      { transform: 'none' },
    ], { duration: motionDuration('content', 'in') * 1000, easing: '' });
    expect(element.style.opacity).toBe('');
    expect(element.style.transform).toBe('');
    expect(element.style.transition).toBe('');
    await act(async () => { animations[0].finish(); await Promise.resolve(); });
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(element.style.cssText).toBe('');
  });

  it('cancels interrupted animation without a stale timer resetting its replacement', async () => {
    const view = (key: string) => <AnimatedSwitch switchKey={key} order={['a', 'b', 'c']} axis="x">content</AnimatedSwitch>;
    const { rerender, unmount } = renderWithI18n(view('a'));
    rerender(view('b'));
    rerender(view('c'));
    expect(animations[0].cancel).toHaveBeenCalled();
    await act(async () => { animations[0].finish(); await Promise.resolve(); });
    expect(animations[1].cancel).not.toHaveBeenCalled();
    unmount();
    expect(animations[1].cancel).toHaveBeenCalled();
  });

  it('uses immediate switching without a spatial relationship or with reduced motion', () => {
    const { rerender } = renderWithI18n(<AnimatedSwitch switchKey="a">content</AnimatedSwitch>);
    rerender(<AnimatedSwitch switchKey="b">content</AnimatedSwitch>);
    expect(animate).not.toHaveBeenCalled();
    stubMatchMedia(true);
    rerender(<AnimatedSwitch switchKey="c" order={['b', 'c']} axis="x">content</AnimatedSwitch>);
    expect(animate).not.toHaveBeenCalled();
  });

  it('scales signed travel with distance, limits it, and uses smaller vertical travel', () => {
    const order = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(switchTravel('a', 'b', order, 'x')).toBeGreaterThan(0);
    expect(switchTravel('b', 'a', order, 'x')).toBeLessThan(0);
    expect(Math.abs(switchTravel('a', 'd', order, 'x'))).toBeGreaterThan(Math.abs(switchTravel('a', 'b', order, 'x')));
    expect(switchTravel('a', 'e', order, 'x')).toBe(switchTravel('a', 'f', order, 'x'));
    expect(Math.abs(switchTravel('a', 'd', order, 'y'))).toBeLessThan(Math.abs(switchTravel('a', 'd', order, 'x')));
    expect(switchTravel('a', 'b', undefined, 'x')).toBe(0);
    expect(switchTravel('a', 'b', order, undefined)).toBe(0);
    expect(switchTravel('a', 'missing', order, 'x')).toBe(0);
  });
});

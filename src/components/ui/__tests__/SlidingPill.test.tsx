import { renderWithI18n } from '../../../test/renderWithI18n';
import { describe, expect, it, vi } from 'vitest';
;
import { SlidingPill, pillTransform, type PillRect } from '../SlidingPill';

const VISIBLE_PILL: PillRect = { left: 10, top: 20, width: 120, height: 32, visible: true };

describe('SlidingPill', () => {
  it('positions the pill through transform instead of layout properties', () => {
    renderWithI18n(<SlidingPill pill={VISIBLE_PILL} />);
    const pill = document.querySelector<HTMLElement>('.tab-sliding-pill')!;
    expect(pill).toBeInTheDocument();
    expect(pill.style.transform).toBe('translate(10px, 20px) scale(1, 1)');
    // left/top 由 CSS 钉在容器原点: 一旦交回给内联样式, 每帧都会重排一次容器。
    expect(pill.style.left).toBe('');
    expect(pill.style.top).toBe('');
  });

  it('keeps width and height on the element so corners and shadow are never stretched', () => {
    renderWithI18n(<SlidingPill pill={VISIBLE_PILL} />);
    const pill = document.querySelector<HTMLElement>('.tab-sliding-pill')!;
    expect(pill.style.width).toBe('120px');
    expect(pill.style.height).toBe('32px');
  });

  it('renders nothing while the pill is hidden', () => {
    renderWithI18n(<SlidingPill pill={{ left: 0, top: 0, width: 0, height: 0, visible: false }} />);
    expect(document.querySelector('.tab-sliding-pill')).toBeNull();
  });

  it('applies the panel variant class', () => {
    renderWithI18n(<SlidingPill pill={VISIBLE_PILL} variant="panel" />);
    expect(document.querySelector('.tab-sliding-pill')).toHaveClass('tab-sliding-pill--panel');
  });

  it('leaves no animated layout property behind after settling', () => {
    const { rerender } = renderWithI18n(<SlidingPill pill={VISIBLE_PILL} />);
    const pill = document.querySelector<HTMLElement>('.tab-sliding-pill')!;
    rerender(<SlidingPill pill={{ left: 150, top: 0, width: 50, height: 32, visible: true }} />);
    // 过渡结束后内联样式里只剩目标 transform 与尺寸, transition 交还给 CSS 类。
    expect(pill.style.transition).toBe('');
    expect(pill.style.transform).toBe('translate(150px, 0px) scale(1, 1)');
  });

  it('reverses into the previous rect before letting transform transition', () => {
    const from: PillRect = { left: 0, top: 0, width: 100, height: 28, visible: true };
    const to: PillRect = { left: 150, top: 0, width: 50, height: 28, visible: true };
    const { rerender } = renderWithI18n(<SlidingPill pill={from} />);
    const pill = document.querySelector<HTMLElement>('.tab-sliding-pill')!;

    // attributeOldValue 给出每次写入"之前"的值, 于是把整条写入链还原出来。
    const observer = new MutationObserver(vi.fn());
    observer.observe(pill, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    rerender(<SlidingPill pill={to} />);
    const written = observer
      .takeRecords()
      .map((record) => record.oldValue)
      .filter((value): value is string => value != null);
    observer.disconnect();

    // 关键顺序: 先出现"看起来还在旧矩形"的姿态, 才是目标姿态。
    // 少了这一步, 浏览器会从上一次已合成的 transform 插值, 尺寸就会瞬间跳变。
    const inversion = written.findIndex((value) => value.includes('translate(0px, 0px) scale(2, 1)'));
    expect(inversion).toBeGreaterThanOrEqual(0);
    expect(pill.style.transform).toBe('translate(150px, 0px) scale(1, 1)');
  });
});

describe('pillTransform', () => {
  it('is the identity when asked to reproduce the element own size', () => {
    const rect: PillRect = { left: 10, top: 20, width: 120, height: 32, visible: true };
    expect(pillTransform(rect, 120, 32)).toBe('translate(10px, 20px) scale(1, 1)');
  });

  it('reproduces another rect by scaling against the laid out size', () => {
    const from: PillRect = { left: 0, top: 0, width: 100, height: 28, visible: true };
    const to: PillRect = { left: 150, top: 0, width: 50, height: 28, visible: true };
    // 尺寸已是目标值, scale 把目标尺寸还原成来源矩形 —— 这就是 FLIP 的起始姿态。
    expect(pillTransform(from, to.width, to.height)).toBe('translate(0px, 0px) scale(2, 1)');
  });

  it('falls back to no scaling when the laid out size is degenerate', () => {
    const rect: PillRect = { left: 5, top: 6, width: 0, height: 0, visible: true };
    expect(pillTransform(rect, 0, 0)).toBe('translate(5px, 6px) scale(1, 1)');
  });
});

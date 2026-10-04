import { expect, test } from '@playwright/test';

const TAB_BAR = '[data-tour="data-tabs"][data-dock-card="data-main"]';

interface PillSample {
  x: number;
  width: number;
  left: string;
  top: string;
  origin: string;
  transitionProperty: string;
  transform: string;
}

const scaleXOf = (transform: string): number | null => {
  const m = /matrix\(([-\d.]+)/.exec(transform);
  return m ? Number(m[1]) : null;
};

/**
 * 浏览器才有布局引擎: jsdom 无论怎么断言都证明不了"过渡期间没有每帧布局"。
 * 这里逐帧采样计算样式, 钉死三件事 —— 位移属性恒为 0、只过渡 transform、
 * 缩放从旧宽度比连续插值回 1。
 */
test('the tab indicator travels by transform alone', async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:8790&token=e2e-token');
  const tabBar = page.locator(TAB_BAR);
  await expect(tabBar).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);

  // 挑一个当前未被药丸覆盖的 Tab, 保证这次切换一定产生位移。
  const target = await page.evaluate((selector) => {
    const bar = document.querySelector(selector)!;
    const pill = bar.querySelector<HTMLElement>('.tab-sliding-pill')!;
    const pillX = pill.getBoundingClientRect().x;
    const pillWidth = pill.getBoundingClientRect().width;
    const tabs = [...bar.querySelectorAll('[data-tab-key]')] as HTMLElement[];
    const index = tabs.findIndex((t) => Math.abs(t.getBoundingClientRect().x - pillX) > 1);
    if (index < 0) return null;
    const rect = tabs[index].getBoundingClientRect();
    return { index, x: rect.x, width: rect.width, fromWidth: pillWidth };
  }, TAB_BAR);
  expect(target, '需要一个未激活的 Tab 才能观察到位移').not.toBeNull();

  await page.evaluate((selector) => {
    const w = window as unknown as { __pillSamples?: PillSample[] };
    w.__pillSamples = [];
    const bar = document.querySelector(selector)!;
    const tick = () => {
      const pill = bar.querySelector('.tab-sliding-pill');
      if (pill) {
        const cs = getComputedStyle(pill);
        const r = pill.getBoundingClientRect();
        w.__pillSamples?.push({
          x: r.x,
          width: r.width,
          left: cs.left,
          top: cs.top,
          origin: cs.transformOrigin,
          transitionProperty: cs.transitionProperty,
          transform: cs.transform,
        });
      }
      if ((w.__pillSamples?.length ?? 0) < 40) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, TAB_BAR);

  // 直接派发 click: 新手引导的遮罩层会拦截真实指针事件, 但 React 的 onClick
  // 与药丸的 FLIP 走的是同一条路径。
  await tabBar.locator('[data-tab-key]').nth(target.index).dispatchEvent('click');
  await page.waitForTimeout(700);

  const samples = await page.evaluate(
    () => (window as unknown as { __pillSamples?: PillSample[] }).__pillSamples ?? []
  );
  expect(samples.length).toBeGreaterThan(4);

  // 位移属性始终留在容器原点, 一旦交回内联样式就会被过渡, 容器每帧重排一次。
  expect([...new Set(samples.map((s) => s.left))]).toEqual(['0px']);
  expect([...new Set(samples.map((s) => s.top))]).toEqual(['0px']);
  expect([...new Set(samples.map((s) => s.transitionProperty))]).toEqual(['transform']);
  expect([...new Set(samples.map((s) => s.origin))]).toEqual(['0px 0px']);

  // 它确实滑过去了, 不是原地瞬移。
  const travel = Math.max(...samples.map((s) => s.x)) - Math.min(...samples.map((s) => s.x));
  expect(travel).toBeGreaterThan(20);

  // 落点就是目标 Tab。
  const settled = samples[samples.length - 1];
  expect(Math.abs(settled.x - target.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(settled.width - target.width)).toBeLessThanOrEqual(1);

  // 宽度真的变了时, 必须看到缩放从旧宽度比插值回 1 —— 这才是尺寸形变,
  // 而不是尺寸瞬变配一个位移过渡。
  if (Math.abs(target.width - target.fromWidth) > 1) {
    const scales = samples.map((s) => scaleXOf(s.transform)).filter((v): v is number => v != null);
    expect(Math.max(...scales)).toBeGreaterThan(1.001);
    expect(scales[scales.length - 1]).toBeCloseTo(1, 2);
    const changing = scales.filter((v, i) => i > 0 && v !== scales[i - 1]).length;
    expect(changing).toBeGreaterThan(1);
  }
});
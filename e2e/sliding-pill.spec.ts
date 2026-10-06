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
  interface PillTarget {
    index: number;
    x: number;
    width: number;
    fromWidth: number;
  }
  const target = await page.evaluate((selector): PillTarget | null => {
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

  // 采样到真正静止为止, 而不是采固定帧数: 多个 worker 并行抢 CPU 时帧率会掉,
  // 固定帧数可能在点击真正生效前就耗尽, 于是"落点"读到的其实是飞行中途的值 ——
  // 这正是这套用例偶发失败的来源。静止判定用 transform 字符串: 它逐帧精确,
  // 不经过取整, 且必须在看到过位移之后才成立 (点击前药丸本来就是静止的)。
  await page.evaluate((selector) => {
    const w = window as unknown as { __pillSamples?: PillSample[]; __pillSettled?: boolean };
    w.__pillSamples = [];
    w.__pillSettled = false;
    const bar = document.querySelector(selector)!;
    const deadline = performance.now() + 5000;
    let firstTransform: string | null = null;
    let lastTransform: string | null = null;
    let stable = 0;
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
        firstTransform ??= cs.transform;
        // 必须"先看到位移, 再数静止": 点击前药丸本来就是静止的, 不能从那一刻起算
        const moving = cs.transform !== firstTransform;
        stable = moving && cs.transform === lastTransform ? stable + 1 : 0;
        lastTransform = cs.transform;
      }
      if (stable < 3 && performance.now() < deadline) requestAnimationFrame(tick);
      else w.__pillSettled = true;
    };
    requestAnimationFrame(tick);
  }, TAB_BAR);

  // 直接派发 click: 新手引导的遮罩层会拦截真实指针事件, 但 React 的 onClick
  // 与药丸的 FLIP 走的是同一条路径。
  await tabBar.locator('[data-tab-key]').nth(target.index).dispatchEvent('click');
  await page.waitForFunction(
    () => (window as unknown as { __pillSettled?: boolean }).__pillSettled === true,
    undefined,
    { timeout: 10_000 }
  );

  const samples = await page.evaluate(
    () => (window as unknown as { __pillSamples?: PillSample[] }).__pillSamples ?? []
  );
  expect(samples.length).toBeGreaterThan(4);

  // 落点与目标必须在同一时刻、用同一把尺子量。药丸的位移是纯 transform, 所以
  // `offsetLeft` 恒为 0 —— 能比的只有渲染矩形。宽度上有一个**已知且正确**的取整差:
  // 药丸几何取自 tab 的 `offsetWidth` (整数 120), 而 tab 的渲染宽度是小数
  // (119.515625), 差值 0.48px 是子像素舍入, 不是错位。容差按此设定, 仍能拦住真正的
  // 错位 (此前 8px 的中途落点就会被拒)。
  const landing = await page.evaluate(
    ({ selector, index }: { selector: string; index: number }) => {
      const bar = document.querySelector(selector)!;
      const pill = bar.querySelector<HTMLElement>('.tab-sliding-pill')!;
      const tabs: HTMLElement[] = Array.from(bar.querySelectorAll<HTMLElement>('[data-tab-key]'));
      const tab = tabs[index];
      const rectOf = (el: HTMLElement) => ({
        x: el.getBoundingClientRect().x,
        width: el.getBoundingClientRect().width,
      });
      return { pill: rectOf(pill), tab: tab ? rectOf(tab) : null };
    },
    { selector: TAB_BAR, index: target?.index ?? 0 }
  );
  expect(landing.tab, '刚点过的 tab 应当还在').not.toBeNull();
  const tab = landing.tab!;

  // 位置必须像素级吻合: 它由 transform 精确给出, 没有取整余地。
  expect(Math.abs(landing.pill.x - tab.x)).toBeLessThanOrEqual(1);
  // 宽度允许子像素取整差, 但不得超出 1px 量级。
  expect(Math.abs(landing.pill.width - tab.width)).toBeLessThanOrEqual(1);

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
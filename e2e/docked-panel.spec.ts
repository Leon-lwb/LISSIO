import { expect, test, type Locator, type Page } from '@playwright/test';

const PANEL = '[data-flip-key="sidebar"]';

interface DrawerSample {
  width: number;
  /** 面板本体的 CSS 过渡时长。宽度已经不由过渡驱动, 它必须恒为 0。 */
  transitionDuration: string;
  /** 中央面板的视觉左边界 —— 布局左边界 + 飞行中的 transform。 */
  centerLeft: number;
  /** 中央面板内联 transform 里的 x 位移; 0 表示没有在飞行。 */
  centerShift: number;
  surfaceMounted: boolean;
  opacity: number;
  origin: string;
  /** 退场时表面沿 dock 轴的横向缩放 —— 1 = 满宽, 小于 1 = 正在朝所属边收。 */
  surfaceScale: number;
  /** 退场时表面沿 dock 轴的位移, px; 方向朝所属边外侧。 */
  surfaceShift: number;
}

/**
 * 浏览器才有布局引擎。停靠面板的空间运动完全由"提交一次布局 + 兄弟面板 transform
 * 让位"构成, jsdom 里既没有 flex-grow 计算也没有合成, 所以只能在真实浏览器里断言。
 *
 * 这里逐帧采样, 钉死四件事:
 *   1. 面板宽度**不经过中间值** —— 它一步到位。这正是"不再逐帧重排面板组"的证据;
 *      旧实现里宽度逐帧插值, 每一帧都让整棵面板子树重新排版。
 *   2. 让位由中央面板的 transform 承担, 且收尾后不留下内联 transform。
 *   3. 退场期间表面仍在 DOM 里且透明度处于 (0,1) —— 这是 MotionPresence 的 retention
 *      换来的东西, 也是"先播退场再收布局"得以成立的前提。
 *   4. 缩放原点锚在左侧 dock 边。
 */
async function startSampling(page: Page, frames: number) {
  await page.evaluate((count) => {
    const w = window as unknown as { __drawer?: DrawerSample[] };
    w.__drawer = [];
    const shiftOf = (el: HTMLElement): number => {
      // GSAP 首帧写 translate(), 之后的动画帧写 translate3d() —— 只认一种会漏掉整段动画。
      const match = /translate3?d?\((-?[\d.]+)px/.exec(el.style.transform ?? '');
      return match ? Number(match[1]) : 0;
    };
    const tick = () => {
      const panel = document.querySelector<HTMLElement>('[data-flip-key="sidebar"]');
      const center = document.querySelector<HTMLElement>('[data-flip-key="center"]');
      const surface = panel?.querySelector<HTMLElement>('[data-motion-variant="panel"]');
      // 表面是否存在只作为**被采样的字段**, 不能当采样条件: 退场结束的那一帧它与
      // 布局收拢同时发生, 拿它当门槛会把整段让位动画一起过滤掉。
      if (panel && center) {
        const shift = shiftOf(center);
        // matrix(a, b, c, d, tx, ty): a = scaleX, tx = 横向位移。
        const matrix = surface ? /matrix\(([^)]+)\)/.exec(getComputedStyle(surface).transform) : null;
        const parts = matrix ? matrix[1].split(',').map(Number) : [];
        w.__drawer?.push({
          width: panel.getBoundingClientRect().width,
          transitionDuration: getComputedStyle(panel).transitionDuration,
          centerLeft: center.getBoundingClientRect().left,
          centerShift: shift,
          surfaceMounted: surface !== null,
          opacity: surface ? Number(getComputedStyle(surface).opacity) : 1,
          origin: surface ? getComputedStyle(surface).transformOrigin : '',
          surfaceScale: parts[0] ?? 1,
          surfaceShift: parts[4] ?? 0,
        });
      }
      if ((w.__drawer?.length ?? 0) < count) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, frames);
}

const readDrawerSamples = (page: Page): Promise<DrawerSample[]> =>
  page.evaluate(() => (window as unknown as { __drawer?: DrawerSample[] }).__drawer ?? []);

/**
 * 当前处于激活态的 ActivityBar 项 —— 只有点它才会收起侧边栏, 点别的项只是换视图。
 *
 * 返回的是按 `data-tour` 定位的稳定 locator, 而不是靠 `bg-bg-active` 现找: 侧边栏
 * 收起后 activeView 被清空, 那一类名会整体消失, 第二次点击就找不到元素了。
 *
 * 用 locator 而不是 `page.evaluate`: 后者在这个仓库的 lint 档下拿不到 DOM 类型,
 * 整条表达式会退化成 `any`。
 */
const sidebarToggle = async (page: Page): Promise<Locator> => {
  const key = await page
    .locator('.bg-bg-activity [data-tour].bg-bg-active')
    .first()
    .getAttribute('data-tour');
  expect(key, '需要一个激活态的 ActivityBar 项才能收起侧边栏').not.toBeNull();
  return page.locator(`.bg-bg-activity [data-tour="${key}"]`).first();
};

test.beforeEach(async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:8790&token=e2e-token');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
});

test('the docked sidebar retracts toward its edge instead of vanishing', async ({ page }) => {
  const open = await page.evaluate(
    (sel) => document.querySelector<HTMLElement>(sel)!.getBoundingClientRect().width,
    PANEL
  );
  expect(open).toBeGreaterThan(40);

  const item = await sidebarToggle(page);

  await startSampling(page, 60);
  // 新手引导的遮罩层会拦截真实指针事件, 但 React 的 onClick 与抽屉走同一条路径。
  await item.dispatchEvent('click');
  await page.waitForTimeout(900);
  const closing = await readDrawerSamples(page);

  expect(closing.length).toBeGreaterThan(4);

  // 面板宽度不由 CSS 过渡插值 —— 这是整条修复的核心断言。
  expect([...new Set(closing.map((s) => s.transitionDuration))]).toEqual(['0s']);

  // 侧边栏默认停靠左边, 缩放原点必须锚在左边 (x = 0), 面板才会朝所属边生长。
  // y 分量是面板实测高度, 不是 50%, 所以只断言 x。
  const anchored = closing.filter((s) => s.origin !== '');
  expect([...new Set(anchored.map((s) => s.origin.split(' ')[0]))]).toEqual(['0px']);

  // 让位由中央面板的 transform 承担: 收起期间它带非零位移, 而不是被瞬移。
  const flying = closing.filter((s) => Math.abs(s.centerShift) > 1);
  expect(flying.length, '中央面板应带 transform 让位').toBeGreaterThan(1);
  // 视觉位置必须真的在动 —— 位移改了, getBoundingClientRect 的 left 也要跟着走。
  const visualLefts = new Set(closing.map((s) => Math.round(s.centerLeft)));
  expect(visualLefts.size, '中央面板应逐帧经过中间位置').toBeGreaterThan(3);

  // 退场期间表面还在, 且不透明度停在中间 —— 这就是 CSS animation 换不来的能力。
  const fading = closing.filter((s) => s.surfaceMounted && s.opacity > 0.02 && s.opacity < 0.98);
  expect(fading.length, '退场应播完才卸载, 而不是节点先消失').toBeGreaterThan(1);

  // 退场是一次朝所属边的收拢, 不是原地淡出: 横向缩放必须真的走过中间值。
  // 侧边栏默认停靠左边, 所以缩放小于 1 意味着它朝左边收 —— 与 transform-origin 同向。
  const scales = closing.map((s) => s.surfaceScale);
  expect(Math.min(...scales), '退场应朝所属 dock 边收缩').toBeLessThan(0.98);
  // 下界同样要断言: 缩放从 1 走到 0.9, 而不是从 0 长起来 —— 后者会让面板在退场
  // 开头先塌成一个点再张开, 那是补间起点读错 (live value 为 0) 的症状。
  expect(Math.min(...scales), '退场不应把面板缩没').toBeGreaterThan(0.85);

  // 位移与缩放同向, 都朝所属边外侧。左边停靠 → 负值。
  expect(Math.min(...closing.map((s) => s.surfaceShift)), '退场应朝所属边外侧让位').toBeLessThan(
    -4
  );

  // 收拢到位后宽度归零, 面板不再占位, 且中央面板不留下内联 transform。
  // 让位是按弹簧推进的, 落定时刻随机器而变 —— 轮询而不是赌一个固定等待。
  await expect
    .poll(async () =>
      page.evaluate((sel) => {
        const panel = document.querySelector<HTMLElement>(sel)!;
        const center = document.querySelector<HTMLElement>('[data-flip-key="center"]')!;
        return `${Math.round(panel.getBoundingClientRect().width)}|${center.style.transform}`;
      }, PANEL)
    )
    .toBe('0|');
});

test('the docked sidebar reopens to the width it had before closing', async ({ page }) => {
  const open = await page.evaluate(
    (sel) => document.querySelector<HTMLElement>(sel)!.getBoundingClientRect().width,
    PANEL
  );

  const item = await sidebarToggle(page);
  await item.dispatchEvent('click');
  await page.waitForTimeout(900);
  await item.dispatchEvent('click');
  await page.waitForTimeout(900);

  const reopened = await page.evaluate(
    (sel) => document.querySelector<HTMLElement>(sel)!.getBoundingClientRect().width,
    PANEL
  );
  // 展开走的是面板组记录的折叠前尺寸, 不是 defaultSize —— 否则用户拉过的宽度会丢。
  expect(Math.abs(reopened - open)).toBeLessThanOrEqual(2);
});

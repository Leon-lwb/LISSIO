import { expect, test, type Locator, type Page } from '@playwright/test';

const PANEL = '[data-flip-key="sidebar"]';

interface DrawerSample {
  width: number;
  flexGrow: string;
  transitionProperty: string;
  surfaceMounted: boolean;
  opacity: number;
  origin: string;
}

/**
 * 浏览器才有布局引擎。停靠面板的空间运动是**宽度收拢** (flex-grow 过渡), jsdom 里
 * flex-grow 根本不参与计算, 所以这个行为只能在真实浏览器里断言。
 *
 * 这里逐帧采样, 钉死三件事:
 *   1. 宽度是逐帧变化的中间值, 不是一步跳到 0 —— 否则"收拢"只是瞬间消失;
 *   2. 退场期间表面仍在 DOM 里且透明度处于 (0,1) —— 这正是 CSS animation 做不到、
 *      而 MotionPresence 的 retention 换来��东西;
 *   3. 过渡只作用在 flex-grow 上, 缩放原点锚在左侧 dock 边。
 */
/** 启动逐帧采样。返回后采样在后台跑, 由 `readDrawerSamples` 取结果。 */
async function startSampling(page: Page, frames: number) {
  await page.evaluate((count) => {
    const w = window as unknown as { __drawer?: DrawerSample[] };
    w.__drawer = [];
    const tick = () => {
      const panel = document.querySelector<HTMLElement>('[data-flip-key="sidebar"]');
      const surface = panel?.querySelector<HTMLElement>('[data-motion-variant="panel"]');
      if (panel && surface) {
        const cs = getComputedStyle(panel);
        w.__drawer?.push({
          width: panel.getBoundingClientRect().width,
          flexGrow: cs.flexGrow,
          transitionProperty: cs.transitionProperty,
          surfaceMounted: true,
          opacity: Number(getComputedStyle(surface).opacity),
          origin: getComputedStyle(surface).transformOrigin,
        });
      }
      if ((w.__drawer?.length ?? 0) < count) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, frames);
}

const readDrawerSamples = (page: Page): Promise<DrawerSample[]> =>
  page.evaluate(
    () => (window as unknown as { __drawer?: DrawerSample[] }).__drawer ?? []
  );

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

  await startSampling(page, 40);
  // 新手引导的遮罩层会拦截真实指针事件, 但 React 的 onClick 与抽屉走同一条路径。
  await item.dispatchEvent('click');
  await page.waitForTimeout(800);
  const closing = await readDrawerSamples(page);

  expect(closing.length).toBeGreaterThan(4);

  // 只过渡 flex-grow。过渡 left/width 会让每帧都重排整个面板组。
  expect([...new Set(closing.map((s) => s.transitionProperty))]).toEqual(['flex-grow']);
  // 侧边栏默认停靠左边, 缩放原点必须锚在左边 (x = 0), 面板才会朝所属边生长。
  // y 分量是面板实测高度, 不是 50%, 所以只断言 x。
  expect([...new Set(closing.map((s) => s.origin.split(' ')[0]))]).toEqual(['0px']);

  // 它是"收拢"过去的: 宽度经过多个中间值, 而不是一步归零。
  const widths = closing.map((s) => s.width);
  const distinct = new Set(widths.map((w) => Math.round(w))).size;
  expect(distinct, '宽度应逐帧经过中间值').toBeGreaterThan(3);
  expect(Math.min(...widths)).toBeLessThan(open);

  // 退场期间表面还在, 且不透明度停在中间 —— 这就是 CSS animation 换来的能力。
  const fading = closing.filter((s) => s.surfaceMounted && s.opacity > 0.02 && s.opacity < 0.98);
  expect(fading.length, '退场应播完才卸载, 而不是节点先消失').toBeGreaterThan(1);

  // 收拢到位后宽度归零, 面板不再占位。
  const closed = await page.evaluate(
    (sel) => document.querySelector<HTMLElement>(sel)!.getBoundingClientRect().width,
    PANEL
  );
  expect(closed).toBeLessThanOrEqual(1);
});

test('the docked sidebar reopens to the width it had before closing', async ({ page }) => {
  const open = await page.evaluate(
    (sel) => document.querySelector<HTMLElement>(sel)!.getBoundingClientRect().width,
    PANEL
  );

  const item = await sidebarToggle(page);
  await item.dispatchEvent('click');
  await page.waitForTimeout(800);
  await item.dispatchEvent('click');
  await page.waitForTimeout(900);

  const reopened = await page.evaluate(
    (sel) => document.querySelector<HTMLElement>(sel)!.getBoundingClientRect().width,
    PANEL
  );
  // 展开走的是面板组记录的折叠前尺寸, 不是 defaultSize —— 否则用户拉过的宽度会丢。
  expect(Math.abs(reopened - open)).toBeLessThanOrEqual(2);
});

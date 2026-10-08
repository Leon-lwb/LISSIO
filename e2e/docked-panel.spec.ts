import { expect, test, type Locator, type Page } from '@playwright/test';

const PANEL = '[data-flip-key="sidebar"]';

interface DrawerSample {
  width: number;
  /** CSS transition duration of the panel body. Width is no longer driven by a transition, so it must always be 0. */
  transitionDuration: string;
  /** Visual left edge of the center panel — layout left edge + the in-flight transform. */
  centerLeft: number;
  /** x displacement in the center panel's inline transform; 0 means it is not flying. */
  centerShift: number;
  surfaceMounted: boolean;
  opacity: number;
  origin: string;
  /** Horizontal scale of the surface along the dock axis during exit — 1 = full width, below 1 = retracting toward its edge. */
  surfaceScale: number;
  /** Displacement of the surface along the dock axis during exit, px; the direction is outward toward its edge. */
  surfaceShift: number;
}

/**
 * Only a browser has a layout engine. The docked panel's spatial motion consists entirely of
 * "one layout commit + sibling panels yielding via transform"; jsdom has neither flex-grow
 * computation nor compositing, so this can only be asserted in a real browser.
 *
 * Sampling frame by frame pins down four things:
 *   1. Panel width **never takes an intermediate value** — it jumps straight to the target.
 *      That is exactly the evidence for "no longer reflowing the panel group every frame";
 *      the old implementation interpolated the width per frame, reflowing the whole panel
 *      subtree on every frame.
 *   2. Yielding is carried by the center panel's transform, and no inline transform is left
 *      behind once it settles.
 *   3. During exit the surface is still in the DOM with opacity in (0,1) — this is what
 *      MotionPresence's retention buys, and the precondition for "play the exit first, then
 *      collapse the layout".
 *   4. The scaling origin is anchored to the left dock edge.
 */
async function startSampling(page: Page, frames: number) {
  await page.evaluate((count) => {
    const w = window as unknown as { __drawer?: DrawerSample[] };
    w.__drawer = [];
    const shiftOf = (el: HTMLElement): number => {
      // GSAP writes translate() on the first frame and translate3d() on later animation frames — matching only one form would miss the whole animation.
      const match = /translate3?d?\((-?[\d.]+)px/.exec(el.style.transform ?? '');
      return match ? Number(match[1]) : 0;
    };
    const tick = () => {
      const panel = document.querySelector<HTMLElement>('[data-flip-key="sidebar"]');
      const center = document.querySelector<HTMLElement>('[data-flip-key="center"]');
      const surface = panel?.querySelector<HTMLElement>('[data-motion-variant="panel"]');
      // Surface presence is only a **sampled field**, never a sampling condition: on the frame
      // where the exit ends it coincides with the layout collapse, so using it as a gate would
      // filter out the entire yield animation along with it.
      if (panel && center) {
        const shift = shiftOf(center);
        // matrix(a, b, c, d, tx, ty): a = scaleX, tx = horizontal displacement.
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
 * The currently active ActivityBar item — only clicking it collapses the sidebar; clicking
 * any other item merely switches the view.
 *
 * The returned locator is a stable one anchored by `data-tour` rather than looked up live via
 * `bg-bg-active`: once the sidebar collapses activeView is cleared, that class name disappears
 * entirely, and the second click would find no element.
 *
 * Use a locator rather than `page.evaluate`: under this repository's lint settings the latter
 * cannot get DOM types, and the whole expression degrades to `any`.
 */
const sidebarToggle = async (page: Page): Promise<Locator> => {
  const key = await page
    .locator('.bg-bg-activity [data-tour].bg-bg-active')
    .first()
    .getAttribute('data-tour');
  expect(key, 'an active ActivityBar item is required to collapse the sidebar').not.toBeNull();
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
  // The onboarding tour overlay intercepts real pointer events, but React's onClick goes down the same path as the drawer.
  await item.dispatchEvent('click');
  await page.waitForTimeout(900);
  const closing = await readDrawerSamples(page);

  expect(closing.length).toBeGreaterThan(4);

  // Panel width is not interpolated by a CSS transition — this is the core assertion of the whole fix.
  expect([...new Set(closing.map((s) => s.transitionDuration))]).toEqual(['0s']);

  // The sidebar docks left by default, so the scaling origin must be anchored on the left (x = 0) for the panel to grow toward its edge.
  // The y component is the panel's measured height, not 50%, so only x is asserted.
  const anchored = closing.filter((s) => s.origin !== '');
  expect([...new Set(anchored.map((s) => s.origin.split(' ')[0]))]).toEqual(['0px']);

  // Yielding is carried by the center panel's transform: while collapsing it has a non-zero displacement instead of being teleported.
  const flying = closing.filter((s) => Math.abs(s.centerShift) > 1);
  expect(flying.length, 'the center panel should yield via transform').toBeGreaterThan(1);
  // The visual position must really move — if the displacement changes, getBoundingClientRect's left must follow.
  const visualLefts = new Set(closing.map((s) => Math.round(s.centerLeft)));
  expect(visualLefts.size, 'the center panel should pass through intermediate positions frame by frame').toBeGreaterThan(3);

  // The surface is still present during exit, with opacity stopped in between — the capability a CSS animation cannot replace.
  const fading = closing.filter((s) => s.surfaceMounted && s.opacity > 0.02 && s.opacity < 0.98);
  expect(fading.length, 'the exit should finish playing before unmounting, not have the node disappear first').toBeGreaterThan(1);

  // The exit is a collapse toward its edge, not a fade in place: the horizontal scale must really pass through intermediate values.
  // The sidebar docks left by default, so a scale below 1 means it collapses toward the left — the same direction as transform-origin.
  const scales = closing.map((s) => s.surfaceScale);
  expect(Math.min(...scales), 'the exit should contract toward its dock edge').toBeLessThan(0.98);
  // The lower bound must be asserted too: the scale goes from 1 down to 0.9, not grows up from 0 — the
  // latter would collapse the panel to a point at the start of the exit and then open it up, the symptom
  // of reading the tween's start point wrong (live value 0).
  expect(Math.min(...scales), 'the exit should not scale the panel out of existence').toBeGreaterThan(0.85);

  // Displacement and scale share a direction, both outward toward the owning edge. Docked left → negative.
  expect(Math.min(...closing.map((s) => s.surfaceShift)), 'the exit should yield outward toward its edge').toBeLessThan(
    -4
  );

  // Once collapsed the width is zero, the panel no longer takes space, and the center panel leaves no inline transform behind.
  // Yielding is advanced by a spring, so the settling moment varies per machine — poll instead of betting on a fixed wait.
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
  // Reopening uses the pre-collapse size recorded by the panel group, not defaultSize — otherwise a width the user dragged would be lost.
  expect(Math.abs(reopened - open)).toBeLessThanOrEqual(2);
});

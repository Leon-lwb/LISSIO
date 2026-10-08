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
 * Only a browser has a layout engine: no assertion in jsdom can prove "no per-frame layout
 * during the transition". Here we sample computed styles frame by frame and pin down three
 * things — the offset properties are always 0, only transform is transitioned, and the scale
 * interpolates continuously from the old width ratio back to 1.
 */
test('the tab indicator travels by transform alone', async ({ page }) => {
  await page.goto('/?server=http://127.0.0.1:8790&token=e2e-token');
  const tabBar = page.locator(TAB_BAR);
  await expect(tabBar).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);

  // Pick a Tab not currently covered by the pill so this switch is guaranteed to produce displacement.
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
  expect(target, 'an inactive Tab is required to observe displacement').not.toBeNull();

  // Sample until truly settled instead of a fixed frame count: the frame rate drops when several
  // workers compete for CPU, and a fixed count can run out before the click really takes effect, so
  // the "landing" reading is actually a mid-flight value — exactly the source of this suite's
  // intermittent failures. Settlement is decided by the transform string: it is exact per frame,
  // never rounded, and only counts once displacement has been observed (the pill is stationary
  // before the click anyway).
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
        // Displacement must be seen first, then stillness counted: the pill is stationary before the click, so it must not count from that moment.
        const moving = cs.transform !== firstTransform;
        stable = moving && cs.transform === lastTransform ? stable + 1 : 0;
        lastTransform = cs.transform;
      }
      if (stable < 3 && performance.now() < deadline) requestAnimationFrame(tick);
      else w.__pillSettled = true;
    };
    requestAnimationFrame(tick);
  }, TAB_BAR);

  // Dispatch click directly: the onboarding tour overlay intercepts real pointer events, but React's
  // onClick goes down the same path as the pill's FLIP.
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

  // The landing point and the target must be measured at the same moment with the same ruler. The
  // pill moves purely by transform, so `offsetLeft` is always 0 — only rendered rects can be
  // compared. In width there is a **known and correct** rounding difference: the pill geometry comes
  // from the tab's `offsetWidth` (the integer 120) while the tab's rendered width is fractional
  // (119.515625), so the 0.48px gap is subpixel rounding, not misalignment. The tolerance is set
  // accordingly and still rejects real misalignment (an 8px mid-flight landing was rejected before).
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
  expect(landing.tab, 'the tab just clicked should still be present').not.toBeNull();
  const tab = landing.tab!;

  // The position must match at pixel level: transform gives it exactly, with no room for rounding.
  expect(Math.abs(landing.pill.x - tab.x)).toBeLessThanOrEqual(1);
  // Width may differ by subpixel rounding, but must not exceed the 1px order of magnitude.
  expect(Math.abs(landing.pill.width - tab.width)).toBeLessThanOrEqual(1);

  // The offset properties always stay at the container origin; once handed back to inline styles they would be transitioned, reflowing the container every frame.
  expect([...new Set(samples.map((s) => s.left))]).toEqual(['0px']);
  expect([...new Set(samples.map((s) => s.top))]).toEqual(['0px']);
  expect([...new Set(samples.map((s) => s.transitionProperty))]).toEqual(['transform']);
  expect([...new Set(samples.map((s) => s.origin))]).toEqual(['0px 0px']);

  // It really slid across, rather than teleporting in place.
  const travel = Math.max(...samples.map((s) => s.x)) - Math.min(...samples.map((s) => s.x));
  expect(travel).toBeGreaterThan(20);

  // The landing point is the target Tab.
  const settled = samples[samples.length - 1];
  expect(Math.abs(settled.x - target.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(settled.width - target.width)).toBeLessThanOrEqual(1);

  // When the width really changed, the scale must be seen interpolating from the old width ratio back
  // to 1 — that is size deformation, not an instantaneous size change paired with an offset transition.
  if (Math.abs(target.width - target.fromWidth) > 1) {
    const scales = samples.map((s) => scaleXOf(s.transform)).filter((v): v is number => v != null);
    expect(Math.max(...scales)).toBeGreaterThan(1.001);
    expect(scales[scales.length - 1]).toBeCloseTo(1, 2);
    const changing = scales.filter((v, i) => i > 0 && v !== scales[i - 1]).length;
    expect(changing).toBeGreaterThan(1);
  }
});
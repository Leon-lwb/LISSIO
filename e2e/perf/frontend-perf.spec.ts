/**
 * Frontend performance measurement — covers three real paths that have been reported as janky.
 *
 * This file only **measures and writes to disk**; it makes no judgement. The judgement lives in
 * `scripts/perf-collect.mjs`, mirroring how `bench-collect.mjs` divides work with Criterion:
 * measurement and refereeing are separate, so the same raw data can be replayed repeatedly and
 * a baseline update does not require rerunning the browser.
 *
 * The scenarios and the pathology each of them targets:
 *
 *   `palette-scroll`      Scrolling a long list. Catches per-frame scroll handling and the cost
 *                         of the sticky header re-blurring every frame while scrolling.
 *   `panel-drawer`        Opening and closing the docked panel. Goes through a one-shot layout
 *                         commit + MotionPresence exit, with yielding carried by the panel
 *                         group's FLIP (writing transform only); the panel is an acrylic
 *                         surface, so this also measures the combination of "a promoted
 *                         compositing layer + a blurred backdrop".
 *   `canvas-drag`         Dragging on the node canvas. Catches the per-frame cost of
 *                         canvas-style interactions; if the hit test finds an overlay blocking
 *                         the pointer, it skips explicitly rather than recording a fake number.
 *
 * There is deliberately **no** gaussian blur scenario here. The original `gaussian-budget` used
 * "the difference in frame-interval p95 between acrylic on and off" as its budget, but headless
 * Chromium locks BeginFrame to 60Hz and quantizes both sides onto the same 16.7ms grid — whether
 * acrylic costs 1ms or 3ms extra is invisible to this measurement in principle; the measured
 * difference was 2.27e-13 ms. More fundamentally, backdrop-filter runs in the compositor while
 * this probe patches main-thread prototypes, so the two are not even on the same thread. The cost
 * of frosting therefore became a **structural budget**: blur radius, tint opacity, and nesting
 * depth, enforced statically by `pnpm check:tokens`. For the rationale and the data, see
 * docs/performance/frontend-render-budget.md.
 *
 * On timing metrics: fps / frame-time percentiles are **recorded but not judged** here. Headless
 * Chromium has no real vsync, so these numbers drift with runner load; using them as a hard gate
 * amounts to teaching the team to ignore a red light. Hard gates rest on deterministic counts,
 * described at the top of probe.ts.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PERF_PROBE_INIT, readProbe, resetProbe, type PerfSample } from './probe';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW_OUT = resolve(REPO_ROOT, 'output', 'perf-frontend', 'raw.json');

const APP_URL = '/?server=http://127.0.0.1:8790&token=e2e-token';

/** The complete record of one scenario measurement. */
interface ScenarioRecord {
  name: string;
  /** Whether the scenario actually ran. When an overlay blocks it, this is false with a written reason and no numbers are produced. */
  ran: boolean;
  /** The reason when ran is false. */
  reason?: string;
  sample?: PerfSample;
}

const records: Record<string, ScenarioRecord> = {};

test.beforeEach(async ({ page }) => {
  // The probe must patch prototypes before the application starts, so inject first, then navigate.
  await page.addInitScript(PERF_PROBE_INIT);
  await page.goto(APP_URL);
  // Wait until the application has actually drawn the workspace, so startup cost is not counted into the scenario.
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.waitForTimeout(1_200);
});

/**
 * Run one scenario: reset the probe → perform the action → freeze and sample.
 *
 * A `settle` quiet period is deliberately left after the action so the probe also captures the
 * tail frames before freezing; without it the last scenario frame would land after the action
 * ends and the sampled frame count would differ every time.
 */
async function measure(
  page: Page,
  name: string,
  action: () => Promise<void>,
  { settle = 400 }: { settle?: number } = {}
): Promise<ScenarioRecord> {
  await resetProbe(page);
  await action();
  await page.waitForTimeout(settle);
  const sample = await readProbe(page);
  const record: ScenarioRecord = {
    name,
    ran: sample.frames > 0,
    sample,
  };
  if (!record.ran) record.reason = 'the window produced no frame samples at all (it may be invisible or completely blocked)';
  records[name] = record;
  return record;
}

/** Long-list scrolling. `palette-list` is an always-present scrollable widget, so no extra data setup is needed. */
async function scrollPalette(page: Page): Promise<void> {
  const list = page.locator('[data-tour="palette-list"]');
  await expect(list).toBeVisible();
  const box = await list.boundingBox();
  if (!box) throw new Error('palette-list has no layout box');
  const x = box.x + box.width / 2;
  // Advance in steps rather than jumping straight to the end: a single scrollTop assignment
  // produces only one frame, so the per-frame cost during scrolling — the very thing to be
  // measured — would not be captured.
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(40);
  }
}

test('palette scroll: per-frame cost while scrolling a long list', async ({ page }) => {
  const record = await measure(page, 'palette-scroll', () => scrollPalette(page));

  // Scrolling itself should not reallocate any canvas backing store. A non-zero value means some
  // component resizes a canvas during scrolling — a deterministic defect that can be fixed directly.
  expect(
    record.sample?.canvasBackingStoreRealloc ?? 0,
    'scrolling should not trigger canvas backing-store reallocation',
  ).toBe(0);
});

test('panel drawer: per-frame cost of opening and closing the docked panel', async ({ page }) => {
  const record = await measure(page, 'panel-drawer', async () => {
    const active = page.locator('.bg-bg-activity [data-tour].bg-bg-active').first();
    const key = await active.getAttribute('data-tour');
    expect(key, 'an active ActivityBar item is required to collapse the sidebar').not.toBeNull();
    const item = page.locator(`.bg-bg-activity [data-tour="${key}"]`).first();
    // dispatchEvent instead of page.mouse: the onboarding tour overlay intercepts real pointers,
    // but React's onClick goes down the same path as the drawer (the same handling as
    // docked-panel.spec.ts).
    await item.dispatchEvent('click');
    await page.waitForTimeout(500);
    await item.dispatchEvent('click');
  });

  expect(record.ran, 'opening and closing the panel should produce frame samples').toBe(true);
});

test('canvas drag: per-frame cost of dragging on the node canvas', async ({ page }) => {
  const canvas = page.locator('[data-tour="canvas"]');
  const skipped: ScenarioRecord = { name: 'canvas-drag', ran: false, reason: '' };

  if (!(await canvas.isVisible().catch(() => false))) {
    skipped.reason = 'the node canvas is not visible (the current view is not the node editor)';
    records['canvas-drag'] = skipped;
    test.info().annotations.push({ type: 'perf', description: skipped.reason });
    return;
  }

  const box = await canvas.boundingBox();
  if (!box) {
    skipped.reason = 'the node canvas has no layout box';
    records['canvas-drag'] = skipped;
    return;
  }

  // Hit test: dragging relies on real pointer events, so if something else floats above the target
  // point we would be measuring the overlay's cost. Better to skip than to write an unrepresentative
  // number into the baseline.
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const hit = await page.evaluate(
    ([px, py]: [number, number]) => {
      const el = document.elementFromPoint(px, py);
      const host = document.querySelector('[data-tour="canvas"]');
      return Boolean(el && host && (host === el || host.contains(el)));
    },
    [x, y] as [number, number]
  );
  if (!hit) {
    skipped.reason = 'the canvas center is covered by an overlay; skipping the drag measurement';
    records['canvas-drag'] = skipped;
    test.info().annotations.push({ type: 'perf', description: skipped.reason });
    return;
  }

  await measure(page, 'canvas-drag', async () => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 16; i += 1) {
      await page.mouse.move(x + i * 6, y + i * 3);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  });
});

test.afterAll(() => {
  // Write to disk even if a scenario failed: partial results are more useful than none, and the
  // judgement script can see which scenarios are missing instead of treating the whole run as
  // "never measured".
  mkdirSync(dirname(RAW_OUT), { recursive: true });
  writeFileSync(
    RAW_OUT,
    `${JSON.stringify({ schema: 1, scenarios: records }, null, 2)}\n`,
    'utf8'
  );
});
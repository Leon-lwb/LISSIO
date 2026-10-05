/**
 * 前端性能计量 —— 覆盖三处已被报告卡顿的真实路径。
 *
 * 这个文件只负责**测量并落盘**, 不做判定。判定在 `scripts/perf-collect.mjs`,
 * 与 `bench-collect.mjs` 对 Criterion 的分工一致: 测量与裁判分离, 于是同一份
 * 原始数据可以反复重放, 基线更新不需要重跑浏览器。
 *
 * 场景与它们各自要抓的病因:
 *
 *   `palette-scroll`      长列表滚动。抓逐帧滚动处理, 以及滚动中 sticky 表头
 *                         每帧重新模糊的开销。
 *   `panel-drawer`        停靠面板开合。走一次性布局提交 + MotionPresence 退场,
 *                         让位由面板组的 FLIP 承担 (只写 transform); 面板是亚克力
 *                         面, 于是同时量到"被 promote 的合成层 + 模糊背景"的叠加。
 *   `canvas-drag`         节点画布拖拽。抓画布类交互的逐帧成本; 若命中测试
 *                         发现有浮层挡住了指针, 明确跳过而不是记一个假数字。
 *
 * 这里**没有**高斯模糊场景, 而且这是刻意的。原 `gaussian-budget` 拿"亚克力开/关
 * 的帧间隔 p95 之差"当预算, 但无头 Chromium 的 BeginFrame 锁 60Hz, 两侧都被量化
 * 到同一根 16.7ms 栅格上 —— 亚克力多花 1ms 还是 3ms, 这个测量在原理上看不见, 实测
 * 差值是 2.27e-13 ms。更根本的是 backdrop-filter 在合成器里做, 而本探针打的是主
 * 线程原型, 两边压根不在同一条线程上。磨砂的成本因此改为**结构性预算**: 模糊半径、
 * 底色透明度、嵌套深度, 由 `pnpm check:tokens` 静态拦。理由与数据见
 * docs/performance/frontend-render-budget.md。
 *
 * 关于时序指标: fps / 帧时间分位在这里**只记录不判定**。无头 Chromium 没有
 * 真实 vsync, 这些数字随 runner 负载漂移; 拿它们当硬门禁等于教团队无视红灯。
 * 硬门禁落在确定性计数上, 详见 probe.ts 顶部的说明。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PERF_PROBE_INIT, readProbe, resetProbe, type PerfSample } from './probe';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW_OUT = resolve(REPO_ROOT, 'output', 'perf-frontend', 'raw.json');

const APP_URL = '/?server=http://127.0.0.1:8790&token=e2e-token';

/** 一次场景测量的完整记录。 */
interface ScenarioRecord {
  name: string;
  /** 场景是否真的跑起来了。被浮层挡住时记 false 并写明原因, 不产出数字。 */
  ran: boolean;
  /** ran 为 false 时的原因。 */
  reason?: string;
  sample?: PerfSample;
}

const records: Record<string, ScenarioRecord> = {};

test.beforeEach(async ({ page }) => {
  // 探针必须在应用启动前挂上原型, 所以先注入再导航。
  await page.addInitScript(PERF_PROBE_INIT);
  await page.goto(APP_URL);
  // 等应用真的把工作区画出来, 避免把启动开销计进场景。
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.waitForTimeout(1_200);
});

/**
 * 跑一个场景: 清零探针 → 执行动作 → 冻结并取样。
 *
 * 动作之间刻意留 `settle` 的静默期, 让探针把尾帧也收进来再冻结; 不静默的话
 * 最后一个场景帧会落在动作结束之后, 采到的帧数每次都不一样。
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
  if (!record.ran) record.reason = '窗口未产生任何帧采样 (可能不可见或被完全阻塞)';
  records[name] = record;
  return record;
}

/** 长列表滚动。`palette-list` 是常驻的可滚动控件, 无需额外搭建数据。 */
async function scrollPalette(page: Page): Promise<void> {
  const list = page.locator('[data-tour="palette-list"]');
  await expect(list).toBeVisible();
  const box = await list.boundingBox();
  if (!box) throw new Error('palette-list 没有布局盒');
  const x = box.x + box.width / 2;
  // 逐段推进而不是一步跳到底: 一次 scrollTop 赋值只产生一帧, 量不到滚动
  // 期间的逐帧成本 —— 而那正是要测的东西。
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(40);
  }
}

test('palette scroll: 长列表滚动期间的逐帧成本', async ({ page }) => {
  const record = await measure(page, 'palette-scroll', () => scrollPalette(page));

  // 滚动本身不该重新分配任何画布后备存储。若这个数不为 0, 说明有组件在
  // 滚动时重设 canvas 尺寸 —— 那是可以直接修掉的确定性缺陷。
  expect(
    record.sample?.canvasBackingStoreRealloc ?? 0,
    '滚动不应触发画布后备存储重分配',
  ).toBe(0);
});

test('panel drawer: 停靠面板开合的逐帧成本', async ({ page }) => {
  const record = await measure(page, 'panel-drawer', async () => {
    const active = page.locator('.bg-bg-activity [data-tour].bg-bg-active').first();
    const key = await active.getAttribute('data-tour');
    expect(key, '需要一个激活态的 ActivityBar 项才能收起侧边栏').not.toBeNull();
    const item = page.locator(`.bg-bg-activity [data-tour="${key}"]`).first();
    // dispatchEvent 而非 page.mouse: 新手引导遮罩会拦截真实指针, 但 React
    // 的 onClick 与抽屉走同一条路径 (与 docked-panel.spec.ts 同一处理)。
    await item.dispatchEvent('click');
    await page.waitForTimeout(500);
    await item.dispatchEvent('click');
  });

  expect(record.ran, '面板开合应产生帧采样').toBe(true);
});

test('canvas drag: 节点画布拖拽的逐帧成本', async ({ page }) => {
  const canvas = page.locator('[data-tour="canvas"]');
  const skipped: ScenarioRecord = { name: 'canvas-drag', ran: false, reason: '' };

  if (!(await canvas.isVisible().catch(() => false))) {
    skipped.reason = '节点画布不可见 (当前视图不是节点编辑器)';
    records['canvas-drag'] = skipped;
    test.info().annotations.push({ type: 'perf', description: skipped.reason });
    return;
  }

  const box = await canvas.boundingBox();
  if (!box) {
    skipped.reason = '节点画布没有布局盒';
    records['canvas-drag'] = skipped;
    return;
  }

  // 命中测试: 拖拽靠真实指针事件, 若目标点上浮着别的东西, 量到的就是浮层的
  // 开销。宁可跳过, 也不要往基线里写一个名不副实的数字。
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
    skipped.reason = '画布中心被浮层遮挡, 跳过拖拽测量';
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
  // 即使某个场景失败也落盘: 部分结果比没有结果更有用, 判定脚本能看出
  // 哪些场景缺失, 而不是把整轮当成"没测过"。
  mkdirSync(dirname(RAW_OUT), { recursive: true });
  writeFileSync(
    RAW_OUT,
    `${JSON.stringify({ schema: 1, scenarios: records }, null, 2)}\n`,
    'utf8'
  );
});
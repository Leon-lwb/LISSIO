import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// dockStore/layoutStore 的 persist 中间件需要 localStorage — 在导入 store 前提供内存桩
vi.hoisted(() => {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = localStorageMock;
});

import { dockDrag, endGhostRelease, __resetForTests, subscribeGhost, type GhostState, type WidgetDragSpec } from '../dockDrag';
import { useDockStore } from '../../../store/dockStore';
import { useLayoutStore } from '../../../store/layoutStore';

/// 构造投放区元素: 挂在 document.body 上, 供 elementFromPoint 命中
function makeZone(attrs: Record<string, string>, parent?: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  (parent ?? document.body).appendChild(el);
  return el;
}

function stubRect(el: HTMLElement, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    });
}

function moveTo(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, button: 0 }));
}

function releaseAt(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, button: 0 }));
}

const INITIAL_ROOT = useDockStore.getState().root;
const INITIAL_CARDS = useDockStore.getState().cards;

function seedCards() {
  useDockStore.setState({
    root: {
      id: 'split-root',
      type: 'split',
      dir: 'row',
      children: [
        { id: 'n1', type: 'card', cardId: 'control-main' },
        { id: 'n2', type: 'card', cardId: 'control-2' },
        { id: 'n3', type: 'card', cardId: 'data-main' },
      ],
      sizes: [40, 30, 30],
    },
    cards: {
      'control-main': { id: 'control-main', kind: 'control', tabIds: ['t1', 't2'], activeTabId: 't1' },
      'control-2': { id: 'control-2', kind: 'control', tabIds: ['t3'], activeTabId: 't3' },
      'data-main': { id: 'data-main', kind: 'data', tabIds: ['d1'], activeTabId: 'd1' },
    },
  });
}

describe('dockDrag 指针拖拽控制器', () => {
  beforeEach(() => {
    __resetForTests();
    useDockStore.setState({ root: INITIAL_ROOT, cards: INITIAL_CARDS });
    useLayoutStore.setState({
      sidebarDock: 'left',
      draggingSidebar: false,
      dockEdgeHover: null,
      aiPanelVisible: false,
      aiDock: 'right',
      aiFloatRect: { x: 220, y: 120, w: 400, h: 480 },
      draggingAiPanel: false,
      aiDockEdgeHover: null,
    });
    document.body.innerHTML = '';
    // jsdom 未实现 elementFromPoint — 默认返回 null (无投放区), 需要时用 spyOn 覆盖
    document.elementFromPoint = () => null;
  });

  it('非左键不启动拖拽', () => {
    dockDrag.begin({ clientX: 10, clientY: 10, button: 2 }, { kind: 'sidebar', label: 'Sidebar' });
    moveTo(100, 100);
    expect(useLayoutStore.getState().draggingSidebar).toBe(false);
  });

  it('移动未超过阈值不激活, 超过阈值后激活并写入 store 状态', () => {
    dockDrag.begin({ clientX: 10, clientY: 10, button: 0 }, { kind: 'sidebar', label: 'Sidebar' });
    moveTo(12, 12); // < 5px
    expect(useLayoutStore.getState().draggingSidebar).toBe(false);

    moveTo(40, 40); // > 5px
    expect(useLayoutStore.getState().draggingSidebar).toBe(true);
    expect(document.body.classList.contains('dragging-dock')).toBe(true);
  });

  it('激活的拖拽提交到卡片边缘 (card-edge) — 拆分落点生效', () => {
    seedCards();
    const zone = makeZone({
      'data-dock-zone': 'card-edge',
      'data-dock-card': 'control-2',
      'data-dock-kind': 'control',
    });
    stubRect(zone, { left: 0, top: 0, width: 200, height: 100 });

    const from = useDockStore.getState().cards['control-main'];
    dockDrag.begin(
      { clientX: 10, clientY: 10, button: 0 },
      { kind: 'tab', tab: { kind: 'control', tabId: 't1', fromCardId: from.id }, label: 'Tab A' }
    );
    moveTo(40, 40); // 激活
    expect(useDockStore.getState().draggingTab).not.toBeNull();

    // 悬停在卡片右半区 → right 边缘
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(zone);
    moveTo(280, 50);
    expect(useDockStore.getState().dropTarget).toEqual({ cardId: 'control-2', edge: 'right' });

    const rootBefore = useDockStore.getState().root;
    releaseAt(280, 50);
    expect(useDockStore.getState().draggingTab).toBeNull();
    expect(useDockStore.getState().dropTarget).toBeNull();
    // 落点生效: 树发生拆分变化
    expect(useDockStore.getState().root).not.toBe(rootBefore);
    vi.restoreAllMocks();
  });

  it('同 kind 跨卡片标题栏悬停为合并目标, 释放后 moveTabToCard', () => {
    seedCards();
    const target = makeZone({
      'data-dock-zone': 'merge',
      'data-dock-card': 'control-2',
      'data-dock-kind': 'control',
    });
    stubRect(target, { left: 0, top: 0, width: 200, height: 100 });

    const from = useDockStore.getState().cards['control-main'];
    dockDrag.begin(
      { clientX: 10, clientY: 10, button: 0 },
      { kind: 'tab', tab: { kind: 'control', tabId: 't2', fromCardId: from.id }, label: 'Tab B' }
    );
    moveTo(40, 40); // 激活

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    moveTo(100, 50);
    expect(useDockStore.getState().mergeHoverCardId).toBe('control-2');
    expect(useDockStore.getState().dropTarget).toBeNull();

    releaseAt(100, 50);
    const targetCard = useDockStore.getState().cards['control-2'];
    expect(targetCard.tabIds).toContain('t2');
    expect(useDockStore.getState().mergeHoverCardId).toBeNull();
    expect(useDockStore.getState().draggingTab).toBeNull();
    vi.restoreAllMocks();
  });

  it('不同 kind 的卡片标题栏不是合并目标', () => {
    seedCards();
    const target = makeZone({
      'data-dock-zone': 'merge',
      'data-dock-card': 'data-main',
      'data-dock-kind': 'data',
    });
    stubRect(target, { left: 0, top: 0, width: 200, height: 100 });

    const from = useDockStore.getState().cards['control-main'];
    dockDrag.begin(
      { clientX: 10, clientY: 10, button: 0 },
      { kind: 'tab', tab: { kind: 'control', tabId: 't1', fromCardId: from.id }, label: 'Tab A' }
    );
    moveTo(40, 40);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    moveTo(100, 50);
    expect(useDockStore.getState().mergeHoverCardId).toBeNull();
    expect(useDockStore.getState().dropTarget).toBeNull();
    vi.restoreAllMocks();
  });

  it('页面边缘热区 (page-edge) 提交到 dropOnRootEdge', () => {
    seedCards();
    const zone = makeZone({ 'data-dock-zone': 'page-edge', 'data-dock-edge': 'left' });

    const from = useDockStore.getState().cards['control-main'];
    dockDrag.begin(
      { clientX: 10, clientY: 10, button: 0 },
      { kind: 'tab', tab: { kind: 'control', tabId: 't1', fromCardId: from.id }, label: 'Tab A' }
    );
    moveTo(40, 40);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(zone);
    moveTo(100, 100);
    expect(useDockStore.getState().dropTarget).toEqual({ cardId: null, edge: 'left' });

    const rootBefore = useDockStore.getState().root;
    releaseAt(100, 100);
    expect(useDockStore.getState().root).not.toBe(rootBefore);
    expect(useDockStore.getState().dropTarget).toBeNull();
    vi.restoreAllMocks();
  });

  it('侧边栏拖拽悬停窗口边缘 → 预览 + 释放后切换停靠侧', () => {
    const zone = makeZone({ 'data-dock-zone': 'sidebar-dock', 'data-dock-edge': 'right' });

    dockDrag.begin({ clientX: 10, clientY: 10, button: 0 }, { kind: 'sidebar', label: 'Sidebar' });
    moveTo(40, 40);
    expect(useLayoutStore.getState().draggingSidebar).toBe(true);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(zone);
    moveTo(100, 100);
    expect(useLayoutStore.getState().dockEdgeHover).toBe('right');

    releaseAt(100, 100);
    expect(useLayoutStore.getState().sidebarDock).toBe('right');
    expect(useLayoutStore.getState().draggingSidebar).toBe(false);
    expect(useLayoutStore.getState().dockEdgeHover).toBeNull();
    vi.restoreAllMocks();
  });

  it('AI 面板拖拽: 悬停边缘热区 → 预览 + 释放后停靠对应边', () => {
    const zone = makeZone({ 'data-dock-zone': 'ai-dock', 'data-dock-edge': 'bottom' });

    dockDrag.begin({ clientX: 10, clientY: 10, button: 0 }, { kind: 'ai-panel', label: 'AI' });
    moveTo(40, 40);
    expect(useLayoutStore.getState().draggingAiPanel).toBe(true);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(zone);
    moveTo(100, 100);
    expect(useLayoutStore.getState().aiDockEdgeHover).toBe('bottom');

    releaseAt(100, 100);
    expect(useLayoutStore.getState().aiDock).toBe('bottom');
    expect(useLayoutStore.getState().draggingAiPanel).toBe(false);
    expect(useLayoutStore.getState().aiDockEdgeHover).toBeNull();
    vi.restoreAllMocks();
  });

  it('AI 面板拖拽: 空白处释放 → 浮动且落点成为浮窗位置 (clamp 窗口内)', () => {
    dockDrag.begin({ clientX: 10, clientY: 10, button: 0 }, { kind: 'ai-panel', label: 'AI' });
    moveTo(400, 300);
    releaseAt(400, 300);

    const st = useLayoutStore.getState();
    expect(st.aiDock).toBe('float');
    expect(st.aiFloatRect.x).toBeGreaterThanOrEqual(8);
    expect(st.aiFloatRect.y).toBeGreaterThanOrEqual(8);
    expect(st.aiFloatRect.w).toBe(400);
    expect(st.draggingAiPanel).toBe(false);
  });

  it('未悬停有效投放区时释放 → 取消拖拽, 不产生落点', () => {
    seedCards();
    dockDrag.begin(
      { clientX: 10, clientY: 10, button: 0 },
      { kind: 'card', cardId: 'control-main', label: 'Card' }
    );
    moveTo(40, 40);
    expect(useDockStore.getState().draggingCardId).toBe('control-main');

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
    moveTo(200, 200);
    expect(useDockStore.getState().dropTarget).toBeNull();

    const rootBefore = useDockStore.getState().root;
    releaseAt(200, 200);
    expect(useDockStore.getState().draggingCardId).toBeNull();
    expect(useDockStore.getState().root).toBe(rootBefore);
    vi.restoreAllMocks();
  });

  it('Escape 取消拖拽并清理状态', () => {
    seedCards();
    dockDrag.begin(
      { clientX: 10, clientY: 10, button: 0 },
      { kind: 'card', cardId: 'control-main', label: 'Card' }
    );
    moveTo(40, 40);
    expect(useDockStore.getState().draggingCardId).toBe('control-main');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(useDockStore.getState().draggingCardId).toBeNull();
    expect(document.body.classList.contains('dragging-dock')).toBe(false);
  });

  it('激活拖拽后 consumeClick 返回 true (抑制拖完的误点击), 普通点击返回 false', () => {
    // 普通点击: 未激活
    dockDrag.begin({ clientX: 10, clientY: 10, button: 0 }, { kind: 'sidebar', label: 'Sidebar' });
    releaseAt(12, 12);
    expect(dockDrag.consumeClick()).toBe(false);

    // 激活拖拽后释放 → 下一次 click 被抑制
    dockDrag.begin({ clientX: 10, clientY: 10, button: 0 }, { kind: 'sidebar', label: 'Sidebar' });
    moveTo(40, 40);
    releaseAt(40, 40);
    expect(dockDrag.consumeClick()).toBe(true);
    expect(dockDrag.consumeClick()).toBe(false);
  });

  it('控件拖拽悬停画布 → 高亮; 释放 → 调用对应画布元素的投放处理并携带 spec', () => {
    seedCards();
    const zone = makeZone({ 'data-dock-zone': 'canvas' });
    stubRect(zone, { left: 0, top: 0, width: 400, height: 300 });

    const hoverSpy = vi.fn();
    dockDrag.subscribeCanvasHover(hoverSpy);

    const handler = vi.fn();
    dockDrag.registerCanvasHandler(zone, (x, y, spec) => { handler(x, y, spec); });

    const spec: WidgetDragSpec = { kind: 'Math', modelId: 'widget:Math', variantId: 'add' };
    dockDrag.begin({ clientX: 10, clientY: 10, button: 0 }, { kind: 'widget', widget: spec, label: 'Math add' });
    moveTo(40, 40);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(zone);
    moveTo(120, 80);
    expect(hoverSpy).toHaveBeenLastCalledWith(true);

    releaseAt(120, 80);
    expect(handler).toHaveBeenCalledWith(120, 80, spec);
    expect(hoverSpy).toHaveBeenLastCalledWith(false);
    vi.restoreAllMocks();
  });

  it('控件落点归属指针下方画布元素注册的处理, 而非最后注册者', () => {
    seedCards();
    const zoneA = makeZone({ 'data-dock-zone': 'canvas' });
    const zoneB = makeZone({ 'data-dock-zone': 'canvas' });
    stubRect(zoneA, { left: 0, top: 0, width: 400, height: 300 });
    stubRect(zoneB, { left: 0, top: 0, width: 400, height: 300 });

    const handlerA = vi.fn();
    const handlerB = vi.fn();
    dockDrag.registerCanvasHandler(zoneA, (x, y, spec) => { handlerA(x, y, spec); });
    dockDrag.registerCanvasHandler(zoneB, (x, y, spec) => { handlerB(x, y, spec); });

    const spec: WidgetDragSpec = { kind: 'Knob' };
    dockDrag.begin({ clientX: 10, clientY: 10, button: 0 }, { kind: 'widget', widget: spec, label: 'Knob' });
    moveTo(40, 40);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(zoneA);
    moveTo(120, 80);
    releaseAt(120, 80);
    expect(handlerA).toHaveBeenCalledWith(120, 80, spec);
    expect(handlerB).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('整卡拖拽悬停他人标题栏 (merge 区) 时穿透到 card-edge 投放区', () => {
    seedCards();
    const cardZone = makeZone({
      'data-dock-zone': 'card-edge',
      'data-dock-card': 'control-2',
      'data-dock-kind': 'control',
    });
    stubRect(cardZone, { left: 0, top: 0, width: 200, height: 100 });
    const titleBar = makeZone(
      { 'data-dock-zone': 'merge', 'data-dock-card': 'control-2', 'data-dock-kind': 'control' },
      cardZone
    );
    stubRect(titleBar, { left: 0, top: 0, width: 200, height: 28 });

    dockDrag.begin(
      { clientX: 10, clientY: 10, button: 0 },
      { kind: 'card', cardId: 'control-main', label: 'Card' }
    );
    moveTo(40, 40);
    expect(useDockStore.getState().draggingCardId).toBe('control-main');

    // 指针在标题栏上 → merge 无效 (整卡拖拽) → 穿透到 card-edge
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(titleBar);
    moveTo(280, 15);
    expect(useDockStore.getState().dropTarget).toEqual({ cardId: 'control-2', edge: 'right' });
    vi.restoreAllMocks();
  });

  it('非控件拖拽穿透画布区, 命中外层卡片的 card-edge 投放区', () => {
    seedCards();
    const cardZone = makeZone({
      'data-dock-zone': 'card-edge',
      'data-dock-card': 'control-2',
      'data-dock-kind': 'control',
    });
    stubRect(cardZone, { left: 0, top: 0, width: 200, height: 100 });
    const canvasZone = makeZone({ 'data-dock-zone': 'canvas' }, cardZone);
    stubRect(canvasZone, { left: 0, top: 0, width: 200, height: 100 });

    const from = useDockStore.getState().cards['control-main'];
    dockDrag.begin(
      { clientX: 10, clientY: 10, button: 0 },
      { kind: 'tab', tab: { kind: 'control', tabId: 't1', fromCardId: from.id }, label: 'Tab A' }
    );
    moveTo(40, 40);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(canvasZone);
    moveTo(280, 50);
    // 穿透 canvas → 命中 card-edge → right
    expect(useDockStore.getState().dropTarget).toEqual({ cardId: 'control-2', edge: 'right' });
    vi.restoreAllMocks();
  });
});

describe('幽灵释放契约', () => {
  /// 手动时钟: 松手速度由最近 90ms 的位移算出, 不推进时钟则所有采样落在同一毫秒,
  /// 速度退化为无穷大, 各种力度都撞上航程上限而看不出差别。
  let clock: number;
  /// 最新一次订阅到的幽灵 — 声明处不给初值, 否则闭包里的赋值会被判定成不可达
  let seen: GhostState | null;

  beforeEach(() => {
    __resetForTests();
    document.body.innerHTML = '';
    document.elementFromPoint = () => null;
    clock = 0;
    seen = null;
    subscribeGhost((state) => {
      seen = state;
    });
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 甩动 steps 步后松手, 返回订阅到的最后一次幽灵状态。 */
  function flingAndObserve(steps: number, stepPx: number, msPerStep = 16) {
    dockDrag.begin({ clientX: 0, clientY: 0, button: 0 }, { kind: 'sidebar', label: 'Dragged' });
    for (let i = 1; i <= steps; i += 1) {
      clock += msPerStep;
      moveTo(i * stepPx, i * stepPx);
    }
    releaseAt(0, 0);
    return seen;
  }

  it('松手只交出速度, 不交出动画数值 — 前冲距离与时长是效果层的职责', () => {
    const ghost = flingAndObserve(6, 30);
    expect(ghost?.velocity).toBeDefined();
    // 契约里不该出现动画数值: 一旦它们出现在这里, 交互层就又认识了弹簧令牌
    expect(ghost).not.toHaveProperty('release');
    expect(ghost).not.toHaveProperty('dx');
    expect(ghost).not.toHaveProperty('durationMs');
  });

  it('幽灵一直存活到效果层报告补间结束 — 交互层不再自己计时', () => {
    dockDrag.begin({ clientX: 0, clientY: 0, button: 0 }, { kind: 'sidebar', label: 'Dragged' });
    clock += 16;
    moveTo(200, 200);
    releaseAt(0, 0);
    // 松手后仍在释放动画中: 幽灵必须还在, 不能松手即消失
    expect(seen?.velocity).toBeDefined();

    // 没有第二个数字在计时: 清除只可能来自效果层的收尾报告
    expect(seen?.velocity).toBeDefined();

    endGhostRelease();
    expect(seen).toBeNull();
  });

  it('收尾报告是幂等的 — 重复上报不会波及下一次拖拽', () => {
    expect(flingAndObserve(6, 30)?.velocity).toBeDefined();
    endGhostRelease();
    endGhostRelease();

    // 收尾后再起一次拖拽: 订阅仍应看到拖拽中的幽灵, 而不是残留的释放态
    dockDrag.begin({ clientX: 0, clientY: 0, button: 0 }, { kind: 'sidebar', label: 'Again' });
    clock += 16;
    moveTo(120, 120);
    expect(seen?.label).toBe('Again');
    expect(seen?.velocity).toBeUndefined();
  });

  it('迟到订阅在释放动画期间补发释放态 — 否则新挂载的幽灵会凭空消失', () => {
    flingAndObserve(6, 30);
    // 组件在松手之后才挂载 (订阅), 此刻幽灵仍可见
    const late: { state: GhostState | null } = { state: null };
    subscribeGhost((state) => {
      late.state = state;
    });
    expect(late.state?.velocity).toBeDefined();
  });

  it('收尾之后迟到订阅补发 null — 否则幽灵会被永久复活且再也无人清除', () => {
    flingAndObserve(6, 30);
    endGhostRelease();
    // 幽灵已消失; 此后挂载的组件必须看到"没有幽灵", 不能重放一段早已播完的释放动画
    const late: { state: GhostState | null } = { state: null };
    subscribeGhost((state) => {
      late.state = state;
    });
    expect(late.state).toBeNull();
  });

  it('新拖拽接管幽灵: 上一次的收尾报告不再清除新状态', () => {
    flingAndObserve(6, 30);
    dockDrag.begin({ clientX: 0, clientY: 0, button: 0 }, { kind: 'sidebar', label: 'Second' });
    clock += 16;
    moveTo(90, 90);
    // 第二次拖拽已接管: 此刻的收尾报告不该清掉正在拖的幽灵
    endGhostRelease();
    expect(seen?.label).toBe('Second');
  });
});

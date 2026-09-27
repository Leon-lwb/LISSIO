import { beforeEach, describe, expect, it, vi } from 'vitest';

// persist 中间件 localStorage 桩 (与 nodePropertiesTab.test.ts 一致)
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

import {
  useDockStore,
  ensurePropertiesExclusiveCard,
  type DockCard,
  type DockNode,
} from '../dockStore';
import { NODE_PROPERTIES_TAB_ID } from '../../types';

const PROP = NODE_PROPERTIES_TAB_ID;
const COMPILE_TABS = ['compile-errors-fixed', 'compile-results-fixed'];

type SplitNode = Extract<DockNode, { type: 'split' }>;
type CardNode = Extract<DockNode, { type: 'card' }>;

function asSplit(node: DockNode): SplitNode {
  if (node.type !== 'split') throw new Error('expected split node');
  return node;
}

function asCard(node: DockNode): CardNode {
  if (node.type !== 'card') throw new Error('expected card node');
  return node;
}

function controlCard(): DockCard {
  return { id: 'control-main', kind: 'control', tabIds: ['t1'], activeTabId: 't1' };
}

function dataCard(id: string, tabIds: string[]): DockCard {
  return { id, kind: 'data', tabIds, activeTabId: tabIds[tabIds.length - 1] ?? null };
}

function propsCard(tabIds: string[]): DockCard {
  return { id: 'properties-main', kind: 'data', tabIds, activeTabId: tabIds[0] ?? null };
}

/// 默认布局: 上排 画布|属性专属卡, 下排数据卡
function defaultLayout(): { root: DockNode; cards: Record<string, DockCard> } {
  return {
    root: {
      id: 'split-root',
      type: 'split',
      dir: 'col',
      children: [
        {
          id: 'split-top',
          type: 'split',
          dir: 'row',
          children: [
            { id: 'node-control', type: 'card', cardId: 'control-main' },
            { id: 'node-props', type: 'card', cardId: 'properties-main' },
          ],
          sizes: [72, 28],
        },
        { id: 'node-data', type: 'card', cardId: 'data-main' },
      ],
      sizes: [55, 45],
    },
    cards: {
      'control-main': controlCard(),
      'data-main': dataCard('data-main', COMPILE_TABS),
      'properties-main': propsCard([PROP]),
    },
  };
}

function setupDock(
  layout: { root: DockNode; cards: Record<string, DockCard> },
  focusedCardId: string | null = null
): void {
  useDockStore.setState({
    root: structuredClone(layout.root),
    cards: structuredClone(layout.cards),
    focusedCardId,
  });
}

function cardWithTab(tabId: string): DockCard | undefined {
  return Object.values(useDockStore.getState().cards).find((c) => c.tabIds.includes(tabId));
}

function findCardByFirstTab(cards: Record<string, DockCard>, tabId: string): DockCard | undefined {
  return Object.values(cards).find((c) => c.tabIds.length > 0 && c.tabIds[0] === tabId);
}

/// 找到把 cardA / cardB 作为直接卡片子节点共同容纳的 split
function findSiblingSplit(
  node: DockNode,
  cardA: string,
  cardB: string
): null | { dir: 'row' | 'col'; sizes: number[]; cardIds: string[] } {
  if (node.type !== 'split') return null;
  const cardIds = node.children.flatMap((c) => (c.type === 'card' ? [c.cardId] : []));
  if (cardIds.includes(cardA) && cardIds.includes(cardB)) {
    return { dir: node.dir, sizes: node.sizes, cardIds };
  }
  for (const child of node.children) {
    const hit = findSiblingSplit(child, cardA, cardB);
    if (hit) return hit;
  }
  return null;
}

beforeEach(() => {
  setupDock(defaultLayout());
});

describe('reconcile 安置排除属性专属卡', () => {
  it('焦点在属性卡 → 新增数据 tab 落入 data-main, 属性卡仍只有属性 tab', () => {
    setupDock(defaultLayout(), 'properties-main');
    useDockStore.getState().reconcile('data', [...COMPILE_TABS, 'can-1', PROP]);

    const cards = useDockStore.getState().cards;
    expect(cards['properties-main'].tabIds).toEqual([PROP]);
    expect(cards['data-main'].tabIds).toEqual([...COMPILE_TABS, 'can-1']);
    expect(cards['data-main'].activeTabId).toBe('can-1');
  });

  it('仅存属性卡 → 新增 tab 新建底部卡, 属性卡不动', () => {
    setupDock(
      {
        root: {
          id: 'split-root',
          type: 'split',
          dir: 'row',
          children: [
            { id: 'n-ctrl', type: 'card', cardId: 'control-main' },
            { id: 'n-props', type: 'card', cardId: 'properties-main' },
          ],
          sizes: [72, 28],
        },
        cards: { 'control-main': controlCard(), 'properties-main': propsCard([PROP]) },
      },
      'properties-main'
    );

    useDockStore.getState().reconcile('data', [PROP, 'can-1']);

    const dock = useDockStore.getState();
    expect(dock.cards['properties-main'].tabIds).toEqual([PROP]);
    const host = cardWithTab('can-1');
    expect(host).toBeDefined();
    expect(host!.tabIds).toEqual(['can-1']);
    // 新卡为根 col split 的底部子节点 [70, 30]
    const rootSplit = asSplit(dock.root);
    expect(rootSplit.dir).toBe('col');
    expect(asCard(rootSplit.children[1]).cardId).toBe(host!.id);
    expect(rootSplit.sizes).toEqual([70, 30]);
  });

  it('属性 tab 无归属 → reconcile 在画布右侧拆专属小卡', () => {
    setupDock({
      root: {
        id: 'split-root',
        type: 'split',
        dir: 'row',
        children: [
          { id: 'n-ctrl', type: 'card', cardId: 'control-main' },
          { id: 'n-data', type: 'card', cardId: 'data-main' },
        ],
        sizes: [70, 30],
      },
      cards: { 'control-main': controlCard(), 'data-main': dataCard('data-main', COMPILE_TABS) },
    });

    useDockStore.getState().reconcile('data', [...COMPILE_TABS, PROP]);

    const dock = useDockStore.getState();
    const propCard = findCardByFirstTab(dock.cards, PROP);
    expect(propCard).toBeDefined();
    // data-main 未收容属性 tab
    expect(dock.cards['data-main'].tabIds).toEqual(COMPILE_TABS);
    const sib = findSiblingSplit(dock.root, 'control-main', propCard!.id);
    expect(sib).not.toBeNull();
    expect(sib!.dir).toBe('row');
    const ctrlIdx = sib!.cardIds.indexOf('control-main');
    const propIdx = sib!.cardIds.indexOf(propCard!.id);
    expect(propIdx).toBe(ctrlIdx + 1); // 画布在左, 属性在右
    expect(sib!.sizes[propIdx]).toBeLessThan(sib!.sizes[ctrlIdx]);
  });

  it('属性 tab 混入普通数据卡 (末位) → 该卡仍是新 tab 的合法落点', () => {
    setupDock(
      {
        root: {
          id: 'split-root',
          type: 'split',
          dir: 'row',
          children: [
            { id: 'n-ctrl', type: 'card', cardId: 'control-main' },
            { id: 'n-data', type: 'card', cardId: 'data-main' },
          ],
          sizes: [70, 30],
        },
        cards: {
          'control-main': controlCard(),
          'data-main': dataCard('data-main', ['compile-results-fixed', PROP]),
        },
      },
      'data-main'
    );

    useDockStore.getState().reconcile('data', ['compile-results-fixed', 'can-1', PROP]);

    const cards = useDockStore.getState().cards;
    expect(cards['data-main'].tabIds).toEqual(['compile-results-fixed', PROP, 'can-1']);
  });

  it('3a 拆新卡后遗留的空属性卡被再次裁剪', () => {
    setupDock({
      root: {
        id: 'split-root',
        type: 'split',
        dir: 'row',
        children: [
          { id: 'n-ctrl', type: 'card', cardId: 'control-main' },
          { id: 'n-props', type: 'card', cardId: 'properties-main' },
        ],
        sizes: [72, 28],
      },
      cards: {
        'control-main': controlCard(),
        'properties-main': { id: 'properties-main', kind: 'data', tabIds: [], activeTabId: null },
      },
    });

    useDockStore.getState().reconcile('data', [PROP]);

    const cards = useDockStore.getState().cards;
    expect(cards['properties-main']).toBeUndefined();
    const propCard = findCardByFirstTab(cards, PROP);
    expect(propCard).toBeDefined();
    expect(propCard!.tabIds).toEqual([PROP]);
  });
});

describe('ensurePropertiesExclusiveCard (属性卡净化)', () => {
  it('属性卡被污染 (prop 首位 + 混入 tab) → 混入 tab 逐出到 data-main', () => {
    const layout = defaultLayout();
    layout.cards['properties-main'] = { ...propsCard([PROP, 'can-1', 'raw-1']), activeTabId: 'can-1' };

    const out = ensurePropertiesExclusiveCard(layout.root, layout.cards);

    expect(out.cards['properties-main'].tabIds).toEqual([PROP]);
    expect(out.cards['properties-main'].activeTabId).toBe(PROP);
    expect(out.cards['data-main'].tabIds).toEqual([...COMPILE_TABS, 'can-1', 'raw-1']);
    expect(out.cards['data-main'].activeTabId).toBe('raw-1');
    expect(out.root).toBe(layout.root);
  });

  it('属性卡被污染且无其他数据卡 → 混入 tab 新建底部卡', () => {
    const layout = {
      root: {
        id: 'split-root',
        type: 'split',
        dir: 'row',
        children: [
          { id: 'n-ctrl', type: 'card', cardId: 'control-main' },
          { id: 'n-props', type: 'card', cardId: 'properties-main' },
        ],
        sizes: [72, 28],
      } as DockNode,
      cards: { 'control-main': controlCard(), 'properties-main': propsCard([PROP, 'can-1']) },
    };

    const out = ensurePropertiesExclusiveCard(layout.root, layout.cards);

    expect(out.cards['properties-main'].tabIds).toEqual([PROP]);
    const host = Object.values(out.cards).find((c) => c.tabIds.includes('can-1'));
    expect(host).toBeDefined();
    expect(host!.tabIds).toEqual(['can-1']);
    const rootSplit = asSplit(out.root);
    expect(rootSplit.dir).toBe('col');
    expect(rootSplit.sizes).toEqual([70, 30]);
    expect(asCard(rootSplit.children[1]).cardId).toBe(host!.id);
  });

  it('prop 混入数据卡末位 (用户合并) → 拆出为画布右侧专属小卡, 原卡保留其余 tab', () => {
    const layout = {
      root: {
        id: 'split-root',
        type: 'split',
        dir: 'row',
        children: [
          { id: 'n-ctrl', type: 'card', cardId: 'control-main' },
          { id: 'n-data', type: 'card', cardId: 'data-main' },
        ],
        sizes: [70, 30],
      } as DockNode,
      cards: {
        'control-main': controlCard(),
        'data-main': { ...dataCard('data-main', ['compile-results-fixed', PROP]), activeTabId: PROP },
      },
    };

    const out = ensurePropertiesExclusiveCard(layout.root, layout.cards);

    expect(out.cards['data-main'].tabIds).toEqual(['compile-results-fixed']);
    expect(out.cards['data-main'].activeTabId).toBe('compile-results-fixed');
    const propCard = findCardByFirstTab(out.cards, PROP);
    expect(propCard).toBeDefined();
    const sib = findSiblingSplit(out.root, 'control-main', propCard!.id);
    expect(sib).not.toBeNull();
    expect(sib!.dir).toBe('row');
    expect(sib!.cardIds.indexOf(propCard!.id)).toBe(sib!.cardIds.indexOf('control-main') + 1);
  });

  it('属性 tab 已独占一卡 → 原样返回 (同一引用)', () => {
    const layout = defaultLayout();
    const out = ensurePropertiesExclusiveCard(layout.root, layout.cards);
    expect(out.root).toBe(layout.root);
    expect(out.cards).toBe(layout.cards);
  });

  it('属性 tab 未被任何卡安置 → 原样返回 (同一引用)', () => {
    const layout = defaultLayout();
    delete layout.cards['properties-main'];
    const out = ensurePropertiesExclusiveCard(layout.root, layout.cards);
    expect(out.root).toBe(layout.root);
    expect(out.cards).toBe(layout.cards);
  });
});

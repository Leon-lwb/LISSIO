import { beforeEach, describe, expect, it, vi } from 'vitest';

// persist 中间件需要 localStorage — 在导入 store 前提供内存桩 (与 dockPropertiesExclusive 一致)
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

// 用轻量替身观察 Panel 收到的 props — 真实库的布局依赖真实测量, 无法在 jsdom 中驱动,
// 而这里要锁定的不变量是"每个 Panel 都必须带显式 order", 与布局测量无关。
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children?: unknown }) => (
    <div data-probe-group="">{children as never}</div>
  ),
  Panel: ({ order, children }: { order?: number; children?: unknown }) => (
    <div data-probe-panel="" data-probe-order={String(order)}>
      {children as never}
    </div>
  ),
  PanelResizeHandle: () => <div data-probe-handle="" />,
}));

vi.mock('../DockCardFrame', () => ({
  DockCardFrame: ({ cardId }: { cardId: string }) => <div data-probe-card={cardId} />,
}));

import { act } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';;
import { DockLayout } from '../DockLayout';
import { useDockStore } from '../../../store/dockStore';
import { useAppStore } from '../../../store/appStore';

/// 分隔条的拖动方向由 react-resizable-panels 的内部面板数组决定:
/// 该数组默认按「注册顺序」排列 —— 卡片被关闭/重新打开时, 某个子 Panel 重新挂载会被
/// 追加到数组末尾而 DOM 位置不变, 两序错位后句柄的 pivot 索引会指到相邻的另一个面板,
/// 于是拖动分隔条朝相反方向移动 (见 runtime 复现: aria-controls 指向 DOM 第二个面板)。
/// 因此每个 Panel 必须显式声明与 DOM 顺序一致的 order。
describe('DockLayout 面板顺序', () => {
  beforeEach(() => {
    useDockStore.persist.clearStorage?.();
  });

  it('每个 split 的 Panel 都带 1..N 的显式 order, 且自左/上向右/下递增', () => {
    const { container } = renderWithI18n(<DockLayout />);

    const groups = [...container.querySelectorAll('[data-probe-group]')];
    expect(groups.length).toBeGreaterThan(0);

    for (const group of groups) {
      const orders = [...group.children]
        .filter((child) => child.hasAttribute('data-probe-panel'))
        .map((child) => child.getAttribute('data-probe-order'));

      // 至少两个面板才构成可拖拽的 split
      expect(orders.length).toBeGreaterThanOrEqual(2);
      // 显式 order (旧实现为 undefined → 'undefined' 字符串)
      expect(orders).toEqual(orders.map((_, index) => String(index + 1)));
    }
  });

  it('卡片被摘除后重建时, 同一 split 的 order 仍然连续', () => {
    const { container } = renderWithI18n(<DockLayout />);
    const before = [...container.querySelectorAll('[data-probe-group]')].length;

    // 模拟"关闭卡片 → 空卡片裁剪"导致 split 折叠, 再重排布局树
    const state = useDockStore.getState();
    const root = state.root;
    if (root.type === 'split' && root.children.length >= 2) {
      const [first, second] = root.children;
      act(() => {
        useDockStore.setState({
          root: { ...root, children: [second, first], sizes: [root.sizes[1], root.sizes[0]] },
        });
      });
    }

    const groups = [...container.querySelectorAll('[data-probe-group]')];
    expect(groups.length).toBe(before);
    for (const group of groups) {
      const orders = [...group.children]
        .filter((child) => child.hasAttribute('data-probe-panel'))
        .map((child) => child.getAttribute('data-probe-order'));
      expect(orders).toEqual(orders.map((_, index) => String(index + 1)));
    }
  });

  it('默认布局下卡片按树结构渲染 (回归: 面板树未被破坏)', () => {
    const { container } = renderWithI18n(<DockLayout />);
    const cards = [...container.querySelectorAll('[data-probe-card]')].map((el) =>
      el.getAttribute('data-probe-card')
    );
    expect(cards).toContain('control-main');
    expect(cards).toContain('data-main');
    void useAppStore;
  });
});

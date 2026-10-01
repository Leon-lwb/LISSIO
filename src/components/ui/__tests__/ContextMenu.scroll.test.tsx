import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';

import { ContextMenu } from '../ContextMenu';
import { useContextMenuStore } from '../../../store/contextMenuStore';

// React 19 的 act 需要显式声明测试环境
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/// 回归: 菜单只在**视口自身**滚动时关闭。
///
/// 工作区运行中数据面板 (RawData/CAN/逻辑) 每帧写 `scrollTop` 追随最新, 捕获阶段
/// 的 window `scroll` 监听若把元素级滚动也算数, 就会在同一帧内关掉刚弹出的菜单 —
/// 表现为"工作区执行时右键完全没反应" (原生菜单也被 preventDefault 挡掉)。
describe('ContextMenu 滚动关闭策略', () => {
  let container: HTMLDivElement;
  let root: Root;

  function openMenu(): void {
    act(() => {
      useContextMenuStore.getState().open(12, 12, [
        { id: 'fit', label: 'Fit', onClick: () => undefined },
      ]);
    });
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    useContextMenuStore.getState().close();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
      root.render(createElement(ContextMenu));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it('元素级滚动 (数据面板追底) 不关闭菜单', () => {
    openMenu();
    expect(container.querySelector('.context-menu')).not.toBeNull();

    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    act(() => {
      // scroll 不冒泡, 但捕获阶段仍会走到 window — 正是被误关的路径
      scroller.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(useContextMenuStore.getState().visible).toBe(true);
    expect(container.querySelector('.context-menu')).not.toBeNull();
    scroller.remove();
  });

  it('视口自身滚动仍然关闭菜单', () => {
    openMenu();
    act(() => {
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    expect(useContextMenuStore.getState().visible).toBe(false);
    expect(container.querySelector('.context-menu')).toBeNull();
  });
});

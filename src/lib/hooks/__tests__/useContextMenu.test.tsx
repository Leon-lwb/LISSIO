import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useContextMenu } from '../useContextMenu';
import { useContextMenuStore } from '../../../store/contextMenuStore';
import type { ContextMenuEntry } from '../../../types';

// React 19 的 act 需要显式声明测试环境
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ items }: { items: ContextMenuEntry[] }) {
  const onContextMenu = useContextMenu(items);
  return <div id="probe" onContextMenu={onContextMenu}>probe</div>;
}

/// 回归: 没有菜单项的表面不能吃掉右键。
///
/// 之前先 `preventDefault` 再判断空列表, 于是数据卡片标签栏这种空菜单表面
/// 右键"什么都不弹" —— 连原生菜单都被挡掉。
describe('useContextMenu 空菜单项', () => {
  let container: HTMLDivElement;
  let root: Root;

  function rightClick(): boolean {
    const probe = container.querySelector('#probe');
    if (!probe) throw new Error('probe 未渲染');
    // dispatchEvent 返回 false = 事件被 preventDefault
    return probe.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
    );
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    useContextMenuStore.getState().close();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  function render(items: ContextMenuEntry[]): void {
    act(() => {
      root = createRoot(container);
      root.render(<Probe items={items} />);
    });
  }

  it('空菜单项: 不 preventDefault, 菜单也不打开', () => {
    render([]);
    expect(rightClick()).toBe(true);
    expect(useContextMenuStore.getState().visible).toBe(false);
  });

  it('有菜单项: preventDefault 并打开菜单', () => {
    render([{ id: 'fit', label: 'Fit', onClick: () => undefined }]);
    expect(rightClick()).toBe(false);
    expect(useContextMenuStore.getState().visible).toBe(true);
  });
});

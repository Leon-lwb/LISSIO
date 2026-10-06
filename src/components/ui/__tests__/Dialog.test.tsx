import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { renderWithI18n } from '../../../test/renderWithI18n';
import { DialogOverlay, DialogSurface } from '../Dialog';

// `DialogSurface` 走 `useGlassSurface`, 它会异步探测折射后端。在 jsdom 里那次
// 探测必然失败并回写档位, 于是用例结束后还有一次状态更新 —— 表现为一串
// "not wrapped in act" 噪声。这里让探测立即失败并把结果落定, 噪声即消失:
// 测试关心的是弹窗契约, 不是玻璃档位。
vi.mock('liquid-gl', () => ({ default: null }));

/// 把 `open` 接到一个按钮上, 这样测试走的是真实的"用户关掉它"路径,
/// 而不是直接 rerender 一个 prop。
function Harness({
  initialOpen = true,
  onDismiss,
  label = 'card',
}: {
  initialOpen?: boolean;
  onDismiss?: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      <button onClick={() => setOpen(false)}>close</button>
      <DialogOverlay open={open} onDismiss={onDismiss}>
        <DialogSurface label={label}>
          <button>inside</button>
        </DialogSurface>
      </DialogOverlay>
    </div>
  );
}

beforeEach(() => {
  // 默认走低动画路径: 离场在同一拍内结束, 于是"关掉了没有"是同步可断言的,
  // 也不会留下跑到用例之外的补间。真正的保活动画由下面单独一条用例覆盖,
  // 它把偏好关掉以走进弹簧路径。
  document.documentElement.classList.add('reduced-motion');
});

afterEach(() => {
  document.documentElement.classList.remove('reduced-motion');
});

describe('Dialog 基本契约', () => {
  it('打开时渲染一个带无障碍语义的卡片', () => {
    renderWithI18n(<Harness />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'card');
    expect(dialog.className).toContain('dialog-surface');
  });

  it('关闭后遮罩与卡片都从 DOM 移除', async () => {
    // 保活只在离场期间; 播完必须真的消失, 否则一个关闭的弹窗会永远挡住点击。
    renderWithI18n(<Harness />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('可以从关闭态重新打开', async () => {
    // 卸载之后重新挂载是常态 (宿主关掉 chunk 引用); 这条守住"关一次就再也开不了"。
    renderWithI18n(<Harness initialOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('open'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('Dialog 关闭意图', () => {
  it('Escape 触发 onDismiss', () => {
    const onDismiss = vi.fn();
    renderWithI18n(<Harness onDismiss={onDismiss} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('关闭后 Escape 不再触发', async () => {
    const onDismiss = vi.fn();
    renderWithI18n(<Harness onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('点击遮罩空白处触发 onDismiss', () => {
    const onDismiss = vi.fn();
    renderWithI18n(<Harness onDismiss={onDismiss} />);

    fireEvent.pointerDown(document.querySelector('.dialog-overlay')!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('点击卡片内部不触发 onDismiss', () => {
    // 用 pointerdown + self-target 判定: 卡片里按下再拖到遮罩上松手不该关闭。
    const onDismiss = vi.fn();
    renderWithI18n(<Harness onDismiss={onDismiss} />);

    fireEvent.pointerDown(screen.getByText('inside'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('卡片里输入时按回车不会关闭整个弹窗', () => {
    // 遮罩以前挂 `role="button"` + onKeyDown, 事件冒泡上来把弹窗关掉 —— 在搜索框
    // 里按回车会关掉设置面板。遮罩不再响应键盘。
    const onDismiss = vi.fn();
    renderWithI18n(<Harness onDismiss={onDismiss} />);

    fireEvent.keyDown(screen.getByText('inside'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByText('inside'), { key: ' ' });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('Dialog 嵌套', () => {
  function Nested({ outerOpen, innerOpen }: { outerOpen: boolean; innerOpen: boolean }) {
    return (
      <DialogOverlay open={outerOpen}>
        <DialogSurface label="outer">
          <DialogOverlay open={innerOpen} zClassName="z-modal-secondary">
            <DialogSurface label="inner">
              <span>inner body</span>
            </DialogSurface>
          </DialogOverlay>
        </DialogSurface>
      </DialogOverlay>
    );
  }

  it('内层打开时是两层 dialog, 各自带自己的标签', () => {
    renderWithI18n(<Nested outerOpen innerOpen />);
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(2);
    expect(dialogs.some((d) => d.getAttribute('aria-label') === 'inner')).toBe(true);
  });

  it('Escape 只关最内层', () => {
    // 两个浮层各自挂 window 监听时, 一次 Escape 会把两层都关掉。
    const inner = vi.fn();
    const outer = vi.fn();

    function Tracked() {
      const [outerOpen, setOuterOpen] = useState(true);
      const [innerOpen, setInnerOpen] = useState(true);
      return (
        <DialogOverlay
          open={outerOpen}
          onDismiss={() => {
            outer();
            setOuterOpen(false);
          }}
        >
          <DialogSurface label="outer">
            <DialogOverlay
              open={innerOpen}
              zClassName="z-modal-secondary"
              onDismiss={() => {
                inner();
                setInnerOpen(false);
              }}
            >
              <DialogSurface label="inner">
                <span>inner body</span>
              </DialogSurface>
            </DialogOverlay>
          </DialogSurface>
        </DialogOverlay>
      );
    }

    renderWithI18n(<Tracked />);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('外层关闭时内层跟着退场', async () => {
    // 设置面板关掉时, 里面的主题编辑器不该留在屏幕上。
    function Follow({ outerOpen, innerOpen }: { outerOpen: boolean; innerOpen: boolean }) {
      return (
        <DialogOverlay open={outerOpen}>
          <DialogSurface label="outer">
            <DialogOverlay open={innerOpen} zClassName="z-modal-secondary">
              <DialogSurface label="inner">
                <span>inner body</span>
              </DialogSurface>
            </DialogOverlay>
          </DialogSurface>
        </DialogOverlay>
      );
    }

    const { rerender } = renderWithI18n(<Follow outerOpen innerOpen />);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);

    rerender(<Follow outerOpen={false} innerOpen />);
    await waitFor(() => {
      expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    });
  });
});

describe('Dialog 保活期间的行为', () => {
  it('关闭瞬间不把卡片内容清空', () => {
    // 离场期间节点还在屏幕上, 内容要留到最后 — 否则用户看到空壳滑出去。
    // 这里刻意关掉低动画偏好, 走进真正的弹簧路径, 于是"关闭后同一拍"就落在
    // 保活窗口内 —— 正是这条断言要覆盖的那一刻。
    document.documentElement.classList.remove('reduced-motion');

    function Content({ open }: { open: boolean }) {
      return (
        <DialogOverlay open={open}>
          <DialogSurface label="card">
            <span>payload</span>
          </DialogSurface>
        </DialogOverlay>
      );
    }

    const { rerender } = renderWithI18n(<Content open />);
    act(() => {
      rerender(<Content open={false} />);
    });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('payload');
  });

  it('保活期间的关闭态遮罩必须 inert — 否则整屏点不动', () => {
    // 离场动画期间遮罩仍在 DOM 里且仍覆盖整屏。关闭态若不 inert, 它就会吃掉整个
    // 应用的点击, 同时把 Tab 序列和无障碍树都圈住 —— 一屏能看见的遮罩是最坏的一种。
    document.documentElement.classList.remove('reduced-motion');

    function Content({ open }: { open: boolean }) {
      return (
        <DialogOverlay open={open}>
          <DialogSurface label="card">
            <span>payload</span>
          </DialogSurface>
        </DialogOverlay>
      );
    }

    const { rerender } = renderWithI18n(<Content open />);
    const opened = document.querySelector('.dialog-overlay');
    expect(opened).not.toBeNull();
    expect(opened).not.toHaveAttribute('inert');

    rerender(<Content open={false} />);
    const retained = document.querySelector('.dialog-overlay');
    expect(retained).not.toBeNull(); // 仍在保活窗口内
    expect(retained).toHaveAttribute('inert');
  });

  it('关闭态不保留可交互的遮罩', async () => {
    // 关着的浮层必须变成零成本: 不拦截指针, 不进无障碍树。
    renderWithI18n(<Harness />);
    fireEvent.click(screen.getByText('close'));

    await waitFor(() => {
      expect(document.querySelector('.dialog-overlay')).toBeNull();
    });
    // 底部的"打开"按钮仍然可点, 说明没有隐形遮罩压在上面。
    expect(screen.getByText('open')).toBeEnabled();
  });
});

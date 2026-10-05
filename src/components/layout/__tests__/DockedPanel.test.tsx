import { render, waitFor } from '@testing-library/react';
import { Panel, PanelGroup } from 'react-resizable-panels';
import { describe, expect, it, vi } from 'vitest';
import { DockedPanel, type DockedPanelProps } from '../DockedPanel';

const DEFAULTS: Omit<DockedPanelProps, 'children'> = {
  id: 'probe',
  order: 2,
  edge: 'right',
  visible: true,
  defaultSize: 24,
  minSize: 14,
  maxSize: 55,
};

/**
 * The docked panel always has the centre panel beside it — a panel group collapses
 * a panel against a neighbour, and a group of one has no pivot to collapse into.
 */
function Group(props: Partial<DockedPanelProps>) {
  return (
    <PanelGroup direction="horizontal">
      <Panel id="center" order={1} className="min-w-0" />
      <DockedPanel {...DEFAULTS} {...props}>
        <div>content</div>
      </DockedPanel>
    </PanelGroup>
  );
}

const panel = () => document.querySelector<HTMLElement>('[data-flip-key="probe"]')!;
const surface = () => document.querySelector<HTMLElement>('[data-motion-variant="panel"]')!;

/** GSAP 把 transform-origin 归一化成百分比; 断言的是它锚在哪条边, 不是写法。 */
const anchor = () => surface().style.transformOrigin;

describe('DockedPanel', () => {
  it('records which edge it is docked to', () => {
    render(<Group edge="left" />);
    expect(panel().dataset.dockEdge).toBe('left');
  });

  it('anchors the surface to the edge it is docked to', () => {
    // 面板的归属只能从缩放原点读出来: 必须朝所属的那条边生长, 否则左右停靠读起来一样。
    render(<Group edge="left" />);
    expect(anchor().startsWith('0%')).toBe(true);
  });

  it('anchors a right-docked panel to the opposite edge from a left-docked one', () => {
    const { unmount } = render(<Group edge="left" />);
    const left = anchor();
    unmount();
    render(<Group edge="right" />);
    // GSAP 归一化后: left → "0% 50%", right → "100% 50%"。
    expect(anchor()).not.toBe(left);
    expect(anchor().startsWith('100%')).toBe(true);
  });

  it('anchors a bottom-docked panel to the bottom edge', () => {
    render(<Group edge="bottom" />);
    // "50% 100%" —— 水平居中, 垂直锚在下边。
    expect(anchor().endsWith('100%')).toBe(true);
  });

  it('keeps its slot when hidden instead of unmounting', () => {
    // 收起后仍在树里, 是"退场播完才卸载"的前提; 也是 FLIP 能测到矩形的原因。
    const { rerender } = render(<Group visible />);
    expect(panel()).toBeInTheDocument();
    rerender(<Group visible={false} />);
    expect(panel()).toBeInTheDocument();
    expect(surface()).toBeInTheDocument();
  });

  it('collapses to zero width rather than unmounting, so the drawer closes', () => {
    render(<Group visible={false} />);
    // collapsedSize=0: 宽度归零是收拢动作本身, 面板必须留在组内才能完成它。
    expect(panel().dataset.panelCollapsible).toBe('true');
    expect(panel().style.flexGrow).toBe('0');
  });

  it('commits the open width immediately, so nothing has to interpolate it', () => {
    render(<Group visible />);
    // 展开时宽度一次到位 —— 不再由 CSS 过渡逐帧重排整个面板组。
    expect(Number(panel().style.flexGrow)).toBeGreaterThan(0);
    // 面板本体不再声明任何抽屉专属的 CSS 状态, 宽度完全由提交决定。
    expect(panel().dataset.dockState).toBeUndefined();
  });

  it('defers the collapse until the exit finishes, so the surface is not clipped away', async () => {
    const { rerender } = render(<Group visible />);
    rerender(<Group visible={false} />);
    // 此刻宽度还没收: 库给 Panel 强制 overflow:hidden, 先收布局会把卡片当场裁没,
    // 退场淡出将完全不可见。
    expect(Number(panel().style.flexGrow)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(panel().style.flexGrow).toBe('0');
    });
  });

  it('reports every size commit exactly once', async () => {
    const onSizeCommit = vi.fn();
    const { rerender } = render(<Group visible onSizeCommit={onSizeCommit} />);
    expect(onSizeCommit).toHaveBeenCalledTimes(1);
    // 退场期间布局还没动, 所以此刻不该有第二次通知。
    rerender(<Group visible={false} onSizeCommit={onSizeCommit} />);
    expect(onSizeCommit).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onSizeCommit).toHaveBeenCalledTimes(2);
    });
    // 重复的同目标提交必须被吞掉, 否则 FLIP 会被无意义的空转触发。
    rerender(<Group visible={false} onSizeCommit={onSizeCommit} />);
    expect(onSizeCommit).toHaveBeenCalledTimes(2);
  });

  it('reopens to its stored width after being closed', async () => {
    const { rerender } = render(<Group visible />);
    const open = Number(panel().style.flexGrow);
    rerender(<Group visible={false} />);
    await waitFor(() => {
      expect(panel().style.flexGrow).toBe('0');
    });
    rerender(<Group visible />);
    // 展开走的是库记录的折叠前尺寸, 不是 defaultSize —— 否则用户拉过的宽度会丢。
    expect(Number(panel().style.flexGrow)).toBe(open);
  });

  it('exposes a stable key so a reorder can track this panel across slots', () => {
    render(<Group />);
    expect(panel().dataset.flipKey).toBe('probe');
  });

  it('lets the surface fill the panel so the width collapse clips it', () => {
    render(<Group />);
    // 面板本体尺寸由 flex-grow 决定; 表面铺满它, 于是收拢时被压向 dock 边。
    expect(surface().className).toContain('h-full');
    expect(surface().className).toContain('w-full');
  });

  it('animates only transform and opacity on the surface', () => {
    render(<Group />);
    // 空间运动只写合成器友好的属性; 宽度由一次性布局提交决定, 既不走补间属性表,
    // 也不由 CSS 过渡逐帧重排。
    const style = surface().getAttribute('style') ?? '';
    expect(style).not.toMatch(/(^|;)\s*(left|top|width|height)\s*:/);
  });
});

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useMemo } from 'react';
import { RetentionScope } from '../RetentionScope';
import { RetentionContext, useRetention, useExitSnapshot, type Retention } from '../retention';

/// 一个自己声明"还在动"的叶子, 用来模拟遮罩/卡片。`busy` 由外部指定,
/// 免得测试还得去驱动真实的弹簧。
function Leaf({ busy, label = 'leaf' }: { busy: boolean; label?: string }) {
  useRetention(busy);
  return <span>{label}</span>;
}

describe('RetentionScope', () => {
  it('打开时渲染子树, 关闭且无人持票时整棵移除', () => {
    const { container, rerender } = render(
      <RetentionScope open>
        <span>content</span>
      </RetentionScope>
    );
    expect(container.textContent).toBe('content');

    rerender(
      <RetentionScope open={false}>
        <span>content</span>
      </RetentionScope>
    );
    expect(container.textContent).toBe('');
  });

  it('持票期间即使已关闭也继续渲染, 交票后才消失', () => {
    // 这正是"退场播完之前不许卸载"的全部机制: 叶子说自己在动, 作用域就得留着。
    // 注意顺序 —— 持票者必须先挂载过, 作用域才可能有票。所以先把 `open` 置真。
    const { container, rerender } = render(
      <RetentionScope open>
        <Leaf busy />
      </RetentionScope>
    );
    expect(container.textContent).toBe('leaf');

    rerender(
      <RetentionScope open={false}>
        <Leaf busy />
      </RetentionScope>
    );
    // 已关闭, 但叶子还在动 —— 节点必须还在。
    expect(container.textContent).toBe('leaf');

    rerender(
      <RetentionScope open={false}>
        <Leaf busy={false} />
      </RetentionScope>
    );
    expect(container.textContent).toBe('');
  });

  it('多个持票者要全部交回才卸载', () => {
    function Pair({ open, aBusy, bBusy }: { open: boolean; aBusy: boolean; bBusy: boolean }) {
      return (
        <RetentionScope open={open}>
          <Leaf busy={aBusy} label="a" />
          <Leaf busy={bBusy} label="b" />
        </RetentionScope>
      );
    }

    const { container, rerender } = render(<Pair open aBusy bBusy />);
    expect(container.textContent).toBe('ab');

    // 第一个先停下, 第二个还在动 —— 不能卸载。
    rerender(<Pair open={false} aBusy={false} bBusy />);
    expect(container.textContent).toBe('ab');

    // 反过来也一样: 最后一个交回之前谁都不能走。
    rerender(<Pair open={false} aBusy bBusy={false} />);
    expect(container.textContent).toBe('ab');

    rerender(<Pair open={false} aBusy={false} bBusy={false} />);
    expect(container.textContent).toBe('');
  });
});

describe('RetentionScope 嵌套', () => {
  function Nested({
    open,
    innerOpen,
    leafBusy,
  }: {
    open: boolean;
    innerOpen: boolean;
    leafBusy: boolean;
  }) {
    return (
      <RetentionScope open={open}>
        <RetentionScope open={innerOpen}>
          <Leaf busy={leafBusy} label="inner" />
        </RetentionScope>
      </RetentionScope>
    );
  }

  it('内层还在忙时外层不卸载', () => {
    // 遮罩先静下来、卡片还在滑出的情形: 外层若按自己的动画卸载, 就会把内层
    // 的最后几帧一起切掉 —— 所以内层在忙时要向外层登记。
    const { container, rerender } = render(<Nested open innerOpen leafBusy />);
    expect(container.textContent).toBe('inner');

    // 外层已关, 内层还开着且叶子还在动。
    rerender(<Nested open={false} innerOpen leafBusy />);
    expect(container.textContent).toBe('inner');
  });

  it('内外都静下来后整棵移除', () => {
    const { container, rerender } = render(<Nested open innerOpen leafBusy />);
    rerender(<Nested open={false} innerOpen={false} leafBusy={false} />);
    expect(container.textContent).toBe('');
  });
});

describe('useRetention', () => {
  interface Box {
    hold: number;
    release: number;
    live: number;
  }

  function Harness({ busy, box }: { busy: boolean; box: Box }) {
    const value = useMemo<Retention>(
      () => ({
        hold: () => {
          box.hold += 1;
          box.live += 1;
          return Symbol('retention');
        },
        release: () => {
          box.release += 1;
          box.live -= 1;
        },
      }),
      [box]
    );
    return (
      <RetentionContext.Provider value={value}>
        <Leaf busy={busy} />
      </RetentionContext.Provider>
    );
  }

  function freshBox(): Box {
    return { hold: 0, release: 0, live: 0 };
  }

  it('busy 期间持票, 静下来时交回', () => {
    const box = freshBox();
    const { rerender } = render(<Harness busy box={box} />);
    expect(box).toMatchObject({ hold: 1, live: 1 });

    rerender(<Harness busy={false} box={box} />);
    expect(box).toMatchObject({ hold: 1, release: 1, live: 0 });

    // 静下来之后的每次渲染都不该再领票, 否则作用域会被钉住。
    rerender(<Harness busy={false} box={box} />);
    expect(box).toMatchObject({ hold: 1, release: 1, live: 0 });
  });

  it('卸载时不会重复交回', () => {
    // 交回走 effect 清理; busy 变化时已经交过一次, 卸载再交一次会让计数变负,
    // 真实实现里则会去删一张早已不在的票。
    const box = freshBox();
    const { rerender, unmount } = render(<Harness busy box={box} />);
    rerender(<Harness busy={false} box={box} />);
    unmount();
    expect(box).toMatchObject({ release: 1, live: 0 });
  });

  it('重新变忙会再领一张新票', () => {
    const box = freshBox();
    const { rerender } = render(<Harness busy box={box} />);
    rerender(<Harness busy={false} box={box} />);
    rerender(<Harness busy box={box} />);
    expect(box).toMatchObject({ hold: 2, release: 1, live: 1 });
  });

  it('没有外层作用域时不报错', () => {
    // 保活是可选增强: 一个自己播动画的组件不该要求祖先里必须有作用域。
    // 这里刻意不包 Provider —— `useContext` 拿到的是默认的 null。
    expect(() => render(<Leaf busy />)).not.toThrow();
    expect(() => render(<Leaf busy={false} />)).not.toThrow();
  });
});

describe('useExitSnapshot', () => {
  function Probe({ value }: { value: string | null }) {
    return <span>{useExitSnapshot(value) ?? 'EMPTY'}</span>;
  }

  it('有值就用当前值', () => {
    const { container } = render(<Probe value="first" />);
    expect(container.textContent).toBe('first');
  });

  it('值被清空后沿用最后一份非空值', () => {
    // 关闭浮层通常顺手把承载数据也清了 (重置表单、清空选中项)。保活期间节点还在
    // 屏幕上, 直接读新值会看到空壳滑出去。
    const { container, rerender } = render(<Probe value="picked" />);
    rerender(<Probe value={null} />);
    expect(container.textContent).toBe('picked');
  });

  it('空字符串与 0 是真实内容, 不该被换成旧值', () => {
    // 判据只能是 null/undefined —— 把""当"已清空"会让一个真的被清空的输入框
    // 在离场时显示上一次的文字。
    function NumberProbe({ value }: { value: number | null }) {
      return <span>{String(useExitSnapshot(value) ?? 'EMPTY')}</span>;
    }
    const { container, rerender } = render(<NumberProbe value={5} />);
    rerender(<NumberProbe value={0} />);
    expect(container.textContent).toBe('0');

    const text = render(<Probe value="typed" />);
    text.rerender(<Probe value="" />);
    expect(text.container.textContent).toBe('');
  });

  it('重新有值后立即更新', () => {
    const { container, rerender } = render(<Probe value="old" />);
    rerender(<Probe value={null} />);
    rerender(<Probe value="new" />);
    expect(container.textContent).toBe('new');

    // 再清空时沿用"new", 而不是更早的 "old"。
    rerender(<Probe value={null} />);
    expect(container.textContent).toBe('new');
  });
});

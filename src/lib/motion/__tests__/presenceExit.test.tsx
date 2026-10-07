//! 退场收尾遗留在元素上的内联样式。
//!
//! 这里用的宿主**始终保留节点**, 而不是像 `DialogSurface` / `MotionPresence` 那样
//! 在收尾后把自己摘掉。理由正是要测的那件事: 摘除由 React 在一次新的调度里提交,
//! 与收尾之间夹着一帧完整渲染 —— 真实 DOM 上抓不到那一帧, 用户却看得到 (关闭动画
//! 播完后整屏遮罩又暗一下, 才消失)。所以把节点留在原地, 直接读收尾留下的样式。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { usePresence } from '../usePresence';
import type { MotionPresenceVariant } from '../motionConfig';

function Surface({
  visible,
  variant,
  onExit,
}: {
  visible: boolean;
  variant: MotionPresenceVariant;
  onExit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePresence(ref, { visible, variant, onExitComplete: onExit });
  return <div ref={ref} data-testid="surface" />;
}

afterEach(() => {
  document.documentElement.classList.remove('reduced-motion');
});

describe('usePresence 的退场收尾', () => {
  it('离场播完后 opacity 留在 0, 不交还样式表', async () => {
    // 遮罩是一整屏压暗层, 卡片的自然值都是不透明: 收尾把 opacity 还回去, 就等于在
    // 卸载前的那一帧把已经淡出的表面重新点亮。
    const onExit = vi.fn();
    const { rerender, getByTestId } = render(
      <Surface visible variant="surface" onExit={onExit} />
    );
    const element = getByTestId('surface');

    rerender(<Surface visible={false} variant="surface" onExit={onExit} />);
    await waitFor(() => expect(onExit).toHaveBeenCalled(), { timeout: 5000 });

    expect(element.style.opacity).toBe('0');
    // transform 仍然照旧归还, 否则同一个元素再次进场时会带着上一次的终点姿态。
    expect(element.style.transform).toBe('');
  });

  it('再次进场后回到自然值, 元素可见', async () => {
    // 上一条的约束不能顺手把进场也按住: 进场收尾必须把 opacity 还给样式表。
    const onExit = vi.fn();
    const { rerender, getByTestId } = render(
      <Surface visible variant="surface" onExit={onExit} />
    );
    const element = getByTestId('surface');

    rerender(<Surface visible={false} variant="surface" onExit={onExit} />);
    await waitFor(() => expect(onExit).toHaveBeenCalled(), { timeout: 5000 });
    expect(element.style.opacity).toBe('0');

    rerender(<Surface visible variant="surface" onExit={onExit} />);
    await waitFor(() => expect(element.style.opacity).toBe(''), { timeout: 5000 });
    expect(element.style.transform).toBe('');
  });
});

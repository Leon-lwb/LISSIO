//! useGlassSurface 的集成测试
//!
//! 测的是**档位在真实 store + 真实 DOM 下的流转**, 而不是 resolveGlassTier 的
//! 纯函数结果 (那部分在 glassTier.test.ts)。这里要证明的是三件容易出错的事:
//!
//!   1. 默认设置下表面落在 blur 档 —— 即引入液态玻璃不改变任何既有观感;
//!   2. 开关 + 后端可用时才到 liquid 档, 且属性确实写到 DOM 上;
//!   3. 档位下降时透镜被销毁 (靠 mountedLensCount 观察), 不留悬挂资源。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useSettingsStore } from '../../../store/settingsStore';
import { DEFAULT_SETTINGS } from '../../../settings/defaults';
import { applyAppearance } from '../../../settings/applyTheme';
import * as engine from '../liquidGlassEngine';
import { useGlassSurface } from '../useGlassSurface';
import { useGlassAppearance } from '../../hooks/useGlassAppearance';
import type { LiquidGLOptions } from 'liquid-gl';

/// 引擎探测走动态 import 拿真实库。测试环境是 jsdom, 没有 GPU, 但库会退到
/// CSS 分支并正常返回实例 —— 我们不关心画布内容, 只关心装配/销毁的调用次数
/// 与档位属性, 所以这里 stub 掉库、保留引擎自身逻辑。
const destroy = vi.fn();
/// 显式标注参数类型: 不标注时 mock.calls 的元组退化成 [] , 取下标直接编译失败。
///
/// mock 刻意复刻上游的两条真实副作用, 否则测不出本模块必须兜住的问题:
///   1. 目标底色被清成 transparent (折射画布画在它下面一层);
///   2. 目标被设成 pointer-events: none —— 上游假定交互由"内容层"承担, 而
///      那个内容层是把元素画进 canvas 的像素镜像, 吃不到指针事件。不兜住这条,
///      设置弹窗在折射档下会整个点不动。
const factory = vi.fn((options: LiquidGLOptions) => {
  const el: HTMLElement | null = document.querySelector(options.target ?? '');
  if (el) {
    el.style.background = 'transparent';
    el.style.pointerEvents = 'none';
  }
  return { destroy };
});

vi.mock('liquid-gl', () => ({ default: factory }));

// prop 名刻意不叫 role: 见 GlassSurface.tsx 的说明 —— role 是 ARIA 语义角色,
// 让它同时表示"玻璃角色"会与无障碍属性冲突。
function Surface({ surfaceRole }: { surfaceRole: 'widget' | 'floating' }) {
  // 走真实绑定 (store → 外观字段 → 档位), 而不是手工构造 appearance:
  // 这条链路本身就是要测的东西, 手工构造会让绑定漂移时测试仍然全绿。
  const glass = useGlassSurface({ role: surfaceRole, appearance: useGlassAppearance() });
  return (
    <div ref={glass.ref} data-testid="surface" data-glass-tier={glass.tier}>
      surface
    </div>
  );
}

function tierOf(): string | null {
  return screen.getByTestId('surface').getAttribute('data-glass-tier');
}

beforeEach(() => {
  factory.mockClear();
  destroy.mockClear();
  engine.destroyAllLenses();
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
});

afterEach(() => {
  engine.destroyAllLenses();
  document.documentElement.removeAttribute('data-glass-tier');
  void applyAppearance(DEFAULT_SETTINGS.appearance);
});

describe('默认设置 — 停在高斯模糊档', () => {
  it('liquidGlass 默认关闭时, 可折射角色得到 blur 而非 liquid', async () => {
    render(<Surface surfaceRole="floating" />);
    await vi.waitFor(() => expect(tierOf()).toBe('blur'));
    expect(factory).not.toHaveBeenCalled();
  });

  it('画布内角色同样停在 blur', async () => {
    render(<Surface surfaceRole="widget" />);
    await vi.waitFor(() => expect(tierOf()).toBe('blur'));
    expect(factory).not.toHaveBeenCalled();
  });

  it('默认档位下不产生任何透镜', async () => {
    render(<Surface surfaceRole="floating" />);
    await vi.waitFor(() => expect(tierOf()).toBe('blur'));
    expect(engine.mountedLensCount()).toBe(0);
  });
});

describe('开启液态玻璃 — 升级到折射档', () => {
  it('开关开启后表面到 liquid 档并装配透镜', async () => {
    render(<Surface surfaceRole="floating" />);
    await vi.waitFor(() => expect(tierOf()).toBe('blur'));

    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: { ...DEFAULT_SETTINGS.appearance, liquidGlass: true },
      },
    });

    await vi.waitFor(() => expect(tierOf()).toBe('liquid'));
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    expect(engine.mountedLensCount()).toBe(1);
  });

  it('传给库的是选择器而不是元素 — 库只认 CSS 选择器', async () => {
    render(<Surface surfaceRole="floating" />);
    await vi.waitFor(() => expect(tierOf()).toBe('blur'));
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: { ...DEFAULT_SETTINGS.appearance, liquidGlass: true },
      },
    });
    await vi.waitFor(() => expect(factory).toHaveBeenCalled());

    const options = factory.mock.calls[0][0];
    expect(options.target).toMatch(/^\.liquid-glass-lens-\d+$/);
    // zIndex 刻意不传: 库据 DOM 推导 (effectiveZ), 画布落在目标下一层。
    // 传全局常量会把画布抬到所有浮层之上, 盖住整个界面。
    expect(options.zIndex).toBeUndefined();
    // 快照取整个 body: 折射要看到的是表面背后的一切, 不只是某个局部容器
    expect(options.snapshot).toBe('body');
  });

  it('预设与强度经由 resolveLensRequest 落到折射参数', async () => {
    render(<Surface surfaceRole="floating" />);
    await vi.waitFor(() => expect(tierOf()).toBe('blur'));
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          liquidGlass: true,
          liquidGlassPreset: 'thick',
          liquidGlassIntensity: 1,
        },
      },
    });
    await vi.waitFor(() => expect(factory).toHaveBeenCalled());

    const options = factory.mock.calls[0][0];
    // thick 预设的倒角深度基线 0.16, 强度 1.0 时不缩放
    expect(options.bevelDepth).toBeCloseTo(0.16, 5);
    expect(options.frost).toBeCloseTo(3, 5);
  });
});

describe('折射档必须仍然可交互', () => {
  it('装配后目标不再被设成 pointer-events: none', async () => {
    // 上游把目标设成不可点, 指望内容层接管交互; 而内容层是像素镜像, 接不到事件。
    // 引擎负责把交互还给目标 —— 否则弹窗在折射档下整个失去交互。
    render(<Surface surfaceRole="floating" />);
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: { ...DEFAULT_SETTINGS.appearance, liquidGlass: true },
      },
    });
    await vi.waitFor(() => expect(tierOf()).toBe('liquid'));

    const surface = screen.getByTestId('surface');
    await vi.waitFor(() => expect(surface.style.pointerEvents).not.toBe('none'));
    expect(surface.style.pointerEvents).toBe('');
  });

  it('关闭折射后样式由库自行还原, 不残留 transparent', async () => {
    render(<Surface surfaceRole="floating" />);
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: { ...DEFAULT_SETTINGS.appearance, liquidGlass: true },
      },
    });
    await vi.waitFor(() => expect(tierOf()).toBe('liquid'));

    useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
    await vi.waitFor(() => expect(tierOf()).toBe('blur'));
    // 上游 destroy() 会恢复它改过的内联样式
    await vi.waitFor(() => expect(destroy).toHaveBeenCalled());
  });
});

describe('关闭液态玻璃 — 拆掉透镜', () => {
  it('从 liquid 退回 blur 时透镜被销毁, 不留悬挂资源', async () => {
    render(<Surface surfaceRole="floating" />);
    await vi.waitFor(() => expect(tierOf()).toBe('blur'));

    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: { ...DEFAULT_SETTINGS.appearance, liquidGlass: true },
      },
    });
    await vi.waitFor(() => expect(engine.mountedLensCount()).toBe(1));

    useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
    await vi.waitFor(() => expect(tierOf()).toBe('blur'));
    expect(destroy).toHaveBeenCalled();
    expect(engine.mountedLensCount()).toBe(0);
  });

  it('组件卸载时透镜被销毁', async () => {
    const view = render(<Surface surfaceRole="floating" />);
    await vi.waitFor(() => expect(tierOf()).toBe('blur'));
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: { ...DEFAULT_SETTINGS.appearance, liquidGlass: true },
      },
    });
    await vi.waitFor(() => expect(engine.mountedLensCount()).toBe(1));

    view.unmount();
    await vi.waitFor(() => expect(engine.mountedLensCount()).toBe(0));
  });
});

describe('自身模糊开关关闭 — 落 solid 且不装配', () => {
  it('floatingGlass 关掉时表面为 solid, 即使液态玻璃开启', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          liquidGlass: true,
          floatingGlass: false,
        },
      },
    });
    render(<Surface surfaceRole="floating" />);
    await vi.waitFor(() => expect(tierOf()).toBe('solid'));
    expect(factory).not.toHaveBeenCalled();
  });

  it('acrylicBackground 关掉时 widget 角色为 solid', async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          liquidGlass: true,
          acrylicBackground: false,
        },
      },
    });
    render(<Surface surfaceRole="widget" />);
    await vi.waitFor(() => expect(tierOf()).toBe('solid'));
    expect(factory).not.toHaveBeenCalled();
  });
});

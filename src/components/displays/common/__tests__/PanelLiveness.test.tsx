import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { renderWithI18n } from '../../../../test/renderWithI18n';;
import { useEffect, type ReactNode } from 'react';

import {
  FrozenPanelOutline,
  LiveStatusBadge,
  PanelLivenessProvider,
  usePanelFollowing,
  usePanelGoLive,
} from '../PanelLiveness';
import { resetDisplayLiveness, setWorkspaceRunState } from '../../../../store/displayLiveness';
import { useAppStore } from '../../../../store/appStore';

const noop = () => undefined;

/// 探针 — 模拟一个实时面板: 上报跟随状态 + 注册跳最新处理
function Probe({ following = true, onGoLive = noop }: { following?: boolean; onGoLive?: () => void }) {
  const reportFollowing = usePanelFollowing();
  useEffect(() => {
    reportFollowing(following);
  }, [reportFollowing, following]);
  usePanelGoLive(onGoLive);
  return null;
}

function panel(ui: ReactNode, panelKey = 'panel-1') {
  return <PanelLivenessProvider panelKey={panelKey}>{ui}</PanelLivenessProvider>;
}

describe('PanelLiveness 时效绑定与角标', () => {
  beforeEach(() => {
    resetDisplayLiveness();
    useAppStore.setState({ lang: 'zh' });
  });

  afterEach(() => {
    cleanup();
    resetDisplayLiveness();
  });

  it('运行中且跟随最新时不显示角标', async () => {
    await act(async () => {
      setWorkspaceRunState('running');
      renderWithI18n(panel(<><Probe /><LiveStatusBadge panelKey="panel-1" /></>));
      await Promise.resolve();
    });
    expect(screen.queryByTestId('display-frozen-badge')).toBeNull();
  });

  it('暂停时显示「非实时」角标', async () => {
    await act(async () => {
      setWorkspaceRunState('running');
      renderWithI18n(panel(<><Probe /><LiveStatusBadge panelKey="panel-1" /></>));
      await Promise.resolve();
    });
    act(() => {
      setWorkspaceRunState('paused');
    });
    expect(screen.getByTestId('display-frozen-badge')).toBeTruthy();
    expect(screen.getByText('非实时')).toBeTruthy();
  });

  it('运行中但面板离开最新时显示角标', async () => {
    await act(async () => {
      setWorkspaceRunState('running');
      renderWithI18n(panel(<><Probe following={false} /><LiveStatusBadge panelKey="panel-1" /></>));
      await Promise.resolve();
    });
    expect(screen.getByTestId('display-frozen-badge')).toBeTruthy();
  });

  it('非实时时给面板内容区描警示色边框 (不改面板底色)', async () => {
    await act(async () => {
      setWorkspaceRunState('running');
      renderWithI18n(panel(<><Probe /><FrozenPanelOutline panelKey="panel-1" /></>));
      await Promise.resolve();
    });
    expect(screen.queryByTestId('display-frozen-outline')).toBeNull();

    act(() => {
      setWorkspaceRunState('paused');
    });
    const outline = screen.getByTestId('display-frozen-outline');
    expect(outline.className).toContain('var(--color-warning)');
    expect(outline.className).toContain('pointer-events-none');
    // 只描边: 不得铺底色改变面板自身配色
    expect(outline.className).not.toContain('bg-');
  });

  it('角标使用 warning token 语义色', async () => {
    await act(async () => {
      setWorkspaceRunState('paused');
      renderWithI18n(panel(<LiveStatusBadge panelKey="panel-1" />));
      await Promise.resolve();
    });
    const badge = screen.getByTestId('display-frozen-badge');
    expect(badge.className).toContain('text-warning');
    expect(badge.className).toContain('border-warning/');
  });

  it('从暂停恢复广播跳最新给面板处理器', async () => {
    const onGoLive = vi.fn();
    await act(async () => {
      setWorkspaceRunState('paused');
      renderWithI18n(panel(<Probe onGoLive={onGoLive} />));
      await Promise.resolve();
    });
    expect(onGoLive).not.toHaveBeenCalled();

    act(() => {
      setWorkspaceRunState('running');
    });
    expect(onGoLive).toHaveBeenCalledTimes(1);
  });

  it('没有 Provider 时面板绑定安全退化 (不抛错也不上报)', async () => {
    await act(async () => {
      setWorkspaceRunState('running');
      renderWithI18n(<Probe following={false} />);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('display-frozen-badge')).toBeNull();
  });
});

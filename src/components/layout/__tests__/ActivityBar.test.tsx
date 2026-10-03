import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';;
import { ActivityBar } from '../ActivityBar';
import { useAppStore } from '../../../store/appStore';

beforeEach(() => {
  useAppStore.setState({
    lang: 'en',
    sidebarView: 'category',
    sidebarVisible: true,
    activeCategory: 'transport',
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ActivityBar 分类导航', () => {
  it('保留快速上手/数据面板/帮助/关于/设置入口, 移除控件面板入口', () => {
    renderWithI18n(<ActivityBar activeView="category" onSelect={() => undefined} />);
    expect(screen.getByTitle('Quick Start')).toBeInTheDocument();
    expect(screen.getByTitle('Panel')).toBeInTheDocument();
    expect(screen.getByTitle('Open Help Center')).toBeInTheDocument();
    expect(screen.getByTitle('About')).toBeInTheDocument();
    expect(screen.getByTitle('Settings')).toBeInTheDocument();
    expect(screen.queryByTitle('Widgets')).not.toBeInTheDocument();
  });

  it('渲染九个控件分类图标, tooltip 为分类名', () => {
    renderWithI18n(<ActivityBar activeView="category" onSelect={() => undefined} />);
    for (const label of [
      'Connections',
      'Parsing & encoding',
      'Sending',
      'Signal processing',
      'Text processing',
      'Display',
      'Interactive inputs',
      'Attributes',
      'Custom',
    ]) {
      expect(screen.getByTitle(label)).toBeInTheDocument();
    }
  });

  it('点击分类图标切换到该分类并展开侧边栏', () => {
    renderWithI18n(<ActivityBar activeView="category" onSelect={() => undefined} />);
    fireEvent.click(screen.getByTitle('Display'));
    const state = useAppStore.getState();
    expect(state.sidebarView).toBe('category');
    expect(state.activeCategory).toBe('display');
    expect(state.sidebarVisible).toBe(true);
  });

  it('再次点击当前激活分类收起侧边栏', () => {
    renderWithI18n(<ActivityBar activeView="category" onSelect={() => undefined} />);
    fireEvent.click(screen.getByTitle('Connections'));
    expect(useAppStore.getState().sidebarVisible).toBe(false);
  });

  it('激活分类按钮高亮, 其余分类不高亮', () => {
    useAppStore.setState({ activeCategory: 'display' });
    renderWithI18n(<ActivityBar activeView="category" onSelect={() => undefined} />);
    expect(screen.getByTitle('Display').className).toContain('bg-bg-active');
    expect(screen.getByTitle('Connections').className).not.toContain('bg-bg-active');
  });

  it('侧边栏收起时无分类高亮', () => {
    renderWithI18n(<ActivityBar activeView={null} onSelect={() => undefined} />);
    expect(screen.getByTitle('Connections').className).not.toContain('bg-bg-active');
  });

  it('快速上手/数据面板仍走 onSelect', () => {
    const onSelect = vi.fn();
    renderWithI18n(<ActivityBar activeView={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Quick Start'));
    expect(onSelect).toHaveBeenCalledWith('quickstart');
    fireEvent.click(screen.getByTitle('Panel'));
    expect(onSelect).toHaveBeenCalledWith('panels');
  });
});

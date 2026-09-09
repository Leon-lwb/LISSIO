import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../appStore';

describe('sidebar slice — 分类导航', () => {
  beforeEach(() => {
    useAppStore.setState({
      sidebarView: 'category',
      sidebarVisible: true,
      activeCategory: 'transport',
    });
  });

  it('默认视图为分类页, 默认分类为 transport 且侧边栏展开', () => {
    const state = useAppStore.getState();
    expect(state.sidebarView).toBe('category');
    expect(state.activeCategory).toBe('transport');
    expect(state.sidebarVisible).toBe(true);
  });

  it('selectCategory 切换到不同分类时保持侧边栏展开', () => {
    useAppStore.getState().selectCategory('display');
    const state = useAppStore.getState();
    expect(state.sidebarView).toBe('category');
    expect(state.activeCategory).toBe('display');
    expect(state.sidebarVisible).toBe(true);
  });

  it('再次点击当前激活分类收起侧边栏', () => {
    useAppStore.getState().selectCategory('transport');
    const state = useAppStore.getState();
    expect(state.sidebarVisible).toBe(false);
    expect(state.sidebarView).toBe('category');
    expect(state.activeCategory).toBe('transport');
  });

  it('侧边栏收起时点击当前分类重新展开', () => {
    useAppStore.setState({ sidebarVisible: false });
    useAppStore.getState().selectCategory('transport');
    const state = useAppStore.getState();
    expect(state.sidebarVisible).toBe(true);
    expect(state.activeCategory).toBe('transport');
  });

  it('selectCategory 从其他视图切到分类页并展开', () => {
    useAppStore.setState({ sidebarView: 'panels', sidebarVisible: true });
    useAppStore.getState().selectCategory('math');
    const state = useAppStore.getState();
    expect(state.sidebarView).toBe('category');
    expect(state.activeCategory).toBe('math');
    expect(state.sidebarVisible).toBe(true);
  });

  it('openCategory 始终展开并定位到目标分类', () => {
    useAppStore.setState({ sidebarView: 'quickstart', sidebarVisible: false });
    useAppStore.getState().openCategory('protocol');
    const state = useAppStore.getState();
    expect(state.sidebarView).toBe('category');
    expect(state.activeCategory).toBe('protocol');
    expect(state.sidebarVisible).toBe(true);
  });

  it('openCategory 目标即当前分类时不收起', () => {
    useAppStore.getState().openCategory('transport');
    expect(useAppStore.getState().sidebarVisible).toBe(true);
  });

  it('toggleSidebar 对 quickstart/panels 的语义不变', () => {
    useAppStore.getState().toggleSidebar('quickstart');
    expect(useAppStore.getState().sidebarView).toBe('quickstart');
    expect(useAppStore.getState().sidebarVisible).toBe(true);
    useAppStore.getState().toggleSidebar('quickstart');
    expect(useAppStore.getState().sidebarVisible).toBe(false);
    useAppStore.getState().toggleSidebar('panels');
    expect(useAppStore.getState().sidebarView).toBe('panels');
    expect(useAppStore.getState().sidebarVisible).toBe(true);
  });

  it('toggleSidebar 对 category 视图沿用同视图收起语义', () => {
    useAppStore.getState().toggleSidebar('category');
    expect(useAppStore.getState().sidebarVisible).toBe(false);
    useAppStore.getState().toggleSidebar('category');
    expect(useAppStore.getState().sidebarVisible).toBe(true);
  });

  it('setSidebarView 切换视图不影响当前分类', () => {
    useAppStore.setState({ activeCategory: 'string' });
    useAppStore.getState().setSidebarView('panels');
    const state = useAppStore.getState();
    expect(state.sidebarView).toBe('panels');
    expect(state.sidebarVisible).toBe(true);
    expect(state.activeCategory).toBe('string');
  });
});

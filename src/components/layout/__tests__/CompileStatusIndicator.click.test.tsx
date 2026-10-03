import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';;
import { useAppStore } from '../../../store/appStore';
import CompileStatusIndicator from '../CompileStatusIndicator';

describe('CompileStatusIndicator Click Behavior', () => {
  beforeEach(() => {
    // Reset store state
    useAppStore.setState({
      lang: 'en',
      errorTabs: [],
      pendingTabs: [],
      tabStates: {},
    });
  });

  it('renders an ok-state green check button when errorTabs and pendingTabs are empty', () => {
    const onClickSpy = vi.fn();
    const { container } = renderWithI18n(<CompileStatusIndicator onClickError={onClickSpy} />);
    // 常驻设计: 无错误时仍显示绿色 CheckCircle 按钮 (点击打开编译面板)
    expect(container.firstChild).not.toBeNull();
    const button = screen.getByRole('button', { name: /0 compile errors?/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(onClickSpy).toHaveBeenCalledTimes(1);
  });

  it('renders a button and calls onClickError when clicked in error state', () => {
    const onClickSpy = vi.fn();
    
    // Seed store with error tabs
    useAppStore.setState({
      errorTabs: ['tab-1'],
      tabStates: { 'tab-1': 'error' },
    });

    renderWithI18n(<CompileStatusIndicator onClickError={onClickSpy} />);
    
    const button = screen.getByRole('button', { name: /1 compile error/i });
    expect(button).toBeInTheDocument();
    
    fireEvent.click(button);
    expect(onClickSpy).toHaveBeenCalledTimes(1);
  });

  it('compact prop hides the count text but maintains the button and clickable behavior', () => {
    const onClickSpy = vi.fn();
    
    useAppStore.setState({
      errorTabs: ['tab-1', 'tab-2'],
      tabStates: { 'tab-1': 'error', 'tab-2': 'error' },
    });

    renderWithI18n(<CompileStatusIndicator compact onClickError={onClickSpy} />);
    
    const button = screen.getByRole('button', { name: /2 compile errors/i });
    expect(button).toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(onClickSpy).toHaveBeenCalledTimes(1);
  });
});

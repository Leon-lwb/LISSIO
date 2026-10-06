import { fireEvent, screen } from '@testing-library/react';
import { renderWithI18n } from '../../test/renderWithI18n';;
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeychainPermissionDialog } from '../KeychainPermissionDialog';
import { useAppStore } from '../../store/appStore';
import { useSettingsStore } from '../../store/settingsStore';

const originalDismiss = useSettingsStore.getState().dismissKeychainPermissionPrompt;
const originalRetry = useSettingsStore.getState().retryKeychainPermission;

describe('KeychainPermissionDialog', () => {
  beforeEach(() => {
    useAppStore.setState({ lang: 'zh' });
    useSettingsStore.setState({
      keychainPermissionRetrying: false,
      keychainPermissionRetryError: null,
      dismissKeychainPermissionPrompt: originalDismiss,
      retryKeychainPermission: originalRetry,
    });
  });

  it('解释权限作用并把不再提醒选择交给稍后处理动作', () => {
    const dismiss = vi.fn();
    useSettingsStore.setState({ dismissKeychainPermissionPrompt: dismiss });
    renderWithI18n(<KeychainPermissionDialog isOpen />);

    expect(screen.getByRole('dialog')).toHaveTextContent('需要访问系统钥匙串');
    expect(screen.getByRole('dialog')).toHaveTextContent('不会写入设置文件');
    expect(screen.getByRole('dialog')).toHaveTextContent('串口、图表及其他功能不受影响');

    fireEvent.click(screen.getByLabelText('不再提醒'));
    fireEvent.click(screen.getByRole('button', { name: '稍后处理' }));
    expect(dismiss).toHaveBeenCalledWith(true);
  });

  it('支持英文重试状态和再次拒绝提示', () => {
    useAppStore.setState({ lang: 'en' });
    useSettingsStore.setState({
      keychainPermissionRetrying: true,
      keychainPermissionRetryError: 'denied',
    });
    renderWithI18n(<KeychainPermissionDialog isOpen />);

    expect(screen.getByRole('button', { name: 'Requesting…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('still not authorized');
  });

  it('关闭后不渲染卡片', () => {
    // 显示与否由宿主的启动闸门决定, 组件不再自己读 store 标记 —— 两处各判一次
    // 迟早会不一致, 而不一致的后果是保活票收不回来 (浮层卡在屏幕上)。
    renderWithI18n(<KeychainPermissionDialog isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsModal } from '../SettingsModal';
import { tauriMock } from '../../test/setup';
import { useAppStore } from '../../store/appStore';
import { useSettingsStore } from '../../store/settingsStore';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import { notify } from '../../lib/tauri/notifications';
import { platform } from '../../lib/platform';

vi.mock('../ai/AiMcpSettings', () => ({ AiMcpSettings: () => null }));

describe('SettingsModal AI prompt folder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(platform, 'getAppVersion').mockResolvedValue('0.6.1');
    notify.dismissAll();
    useAppStore.setState({ lang: 'zh' });
    useSettingsStore.setState({
      settings: DEFAULT_SETTINGS,
      isOpen: true,
      activeCategory: 'ai',
      searchQuery: '',
    });
  });

  afterEach(() => {
    cleanup();
    notify.dismissAll();
    vi.restoreAllMocks();
  });

  it('opens the settings directory for the Markdown prompt', async () => {
    render(<SettingsModal />);

    expect(screen.getByRole('dialog')).toHaveTextContent('ai-system-prompt.md');
    fireEvent.click(screen.getByRole('button', { name: '打开设置文件夹' }));

    await waitFor(() => {
      expect(tauriMock.invoke).toHaveBeenCalledWith('open_settings_folder');
    });
  });

  it('shows the open failure instead of silently dropping it', async () => {
    tauriMock.invoke.mockImplementation((cmd: string) =>
      cmd === 'open_settings_folder'
        ? Promise.reject(new Error('permission denied'))
        : Promise.resolve(undefined)
    );
    render(<SettingsModal />);

    fireEvent.click(screen.getByRole('button', { name: '打开设置文件夹' }));

    await waitFor(() => {
      expect(notify.getList()).toEqual([
        expect.objectContaining({
          severity: 'error',
          title: '打开设置文件夹失败',
          message: 'permission denied',
        }),
      ]);
    });
  });

  it('uses breadcrumbs for separate plugin and MCP second-level screens', () => {
    render(<SettingsModal />);

    expect(screen.getByRole('navigation', { name: '设置导航' })).toHaveTextContent('设置');
    fireEvent.click(screen.getByRole('button', { name: '打开插件设置' }));
    expect(screen.getByRole('navigation', { name: '设置导航' })).toHaveTextContent('插件');
    expect(screen.getByRole('checkbox', { name: '启用软件内置插件' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: '启用 Fetch 网页' })).toBeEnabled();

    const breadcrumb = screen.getByRole('navigation', { name: '设置导航' });
    fireEvent.click(within(breadcrumb).getByRole('button', { name: 'AI' }));
    fireEvent.click(screen.getByRole('button', { name: '打开 MCP 设置' }));
    expect(screen.getByRole('navigation', { name: '设置导航' })).toHaveTextContent('MCP');
  });

  it('keeps plugin master switches on the first level and gates plugin details', () => {
    render(<SettingsModal />);

    fireEvent.click(screen.getByRole('checkbox', { name: '插件' }));
    fireEvent.click(screen.getByRole('button', { name: '打开插件设置' }));

    expect(screen.getByText('插件总开关已关闭')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '启用软件内置插件' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '启用 Fetch 网页' })).toBeDisabled();
  });
});

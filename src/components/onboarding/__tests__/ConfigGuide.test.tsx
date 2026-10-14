import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';
import { ConfigGuide } from '../ConfigGuide';
import { tauriMock } from '../../../test/setup';
import { platform } from '../../../lib/platform';
import { DEFAULT_SETTINGS } from '../../../settings/defaults';
import {
  DEFAULT_CONFIG_GUIDE_SOURCES,
  type ConfigGuideSources,
} from '../../../settings/configGuideSources';
import { DARK_THEME } from '../../../settings/theme';
import { useAppStore } from '../../../store/appStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useConfigGuideStore } from '../../../store/configGuideStore';
import { notify } from '../../../lib/tauri/notifications';

const APP_VERSION = '9.9.9';
/// 全新安装: 没有设置文档 —— 引导会自动出现, 语言预选英文。
const FRESH_SOURCES: ConfigGuideSources = DEFAULT_CONFIG_GUIDE_SOURCES;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(platform, 'getAppVersion').mockResolvedValue(APP_VERSION);
  notify.dismissAll();
  useAppStore.setState({ lang: 'zh' });
  useSettingsStore.setState({
    settings: structuredClone(DEFAULT_SETTINGS),
    configGuideSources: FRESH_SOURCES,
    loaded: true,
    loadError: null,
    saveError: null,
    saving: false,
  });
  useConfigGuideStore.setState({
    isOpen: true,
    completedThisSession: false,
    sources: FRESH_SOURCES,
  });
});

afterEach(() => {
  cleanup();
  notify.dismissAll();
  vi.restoreAllMocks();
});

describe('ConfigGuide', () => {
  it('opens on the language step and lists all three steps', () => {
    renderWithI18n(<ConfigGuide />);

    expect(screen.getByText('配置引导')).toBeTruthy();
    expect(screen.getByRole('button', { name: '中文' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'English' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1. 界面语言' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2. 配色主题' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '3. 动画与磨砂' })).toBeTruthy();
    // 语言页右侧是品牌标志与文字样例
    expect(screen.getByText('文字效果')).toBeTruthy();
  });

  it('preselects English and applies it live on a fresh installation', async () => {
    useConfigGuideStore.getState().open();
    renderWithI18n(<ConfigGuide />);

    await waitFor(() => {
      expect(useAppStore.getState().lang).toBe('en');
    });
    expect(useSettingsStore.getState().settings.general.language).toBe('en');
    expect(screen.getByText('Configuration guide')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches the language live and labels it as a manual choice', async () => {
    useConfigGuideStore.getState().open();
    renderWithI18n(<ConfigGuide />);
    await waitFor(() => expect(useAppStore.getState().lang).toBe('en'));

    fireEvent.click(screen.getByRole('button', { name: '中文' }));

    await waitFor(() => expect(useAppStore.getState().lang).toBe('zh'));
    expect(useSettingsStore.getState().settings.general.language).toBe('zh');
    expect(screen.getByText('配置引导')).toBeTruthy();
    expect(screen.getByText('手动选择')).toBeTruthy();
  });

  it('walks forward and back between steps', () => {
    renderWithI18n(<ConfigGuide />);

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('配色效果')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '3. 动画与磨砂' }));
    expect(screen.getByText('动效与磨砂')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByText('配色效果')).toBeTruthy();
  });

  it('applies a built-in theme on click and labels it as a manual choice', () => {
    renderWithI18n(<ConfigGuide />);
    fireEvent.click(screen.getByRole('button', { name: '2. 配色主题' }));
    fireEvent.click(screen.getByRole('button', { name: /浅色/ }));

    expect(useSettingsStore.getState().settings.appearance.theme).toBe('light');
    expect(screen.getByText('手动选择')).toBeTruthy();
  });

  it('keeps a custom theme selectable instead of dropping it', () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        appearance: {
          ...state.settings.appearance,
          theme: 'my-custom',
          customThemes: [
            { id: 'my-custom', name: 'Mine', isBuiltIn: false, tokens: DARK_THEME.tokens },
          ],
        },
      },
    }));
    renderWithI18n(<ConfigGuide />);
    fireEvent.click(screen.getByRole('button', { name: '2. 配色主题' }));

    const custom = screen.getByRole('button', { name: /当前自定义主题/ });
    expect(custom.getAttribute('aria-pressed')).toBe('true');
    expect(useSettingsStore.getState().settings.appearance.theme).toBe('my-custom');
  });

  it('writes the motion and glass choices of the third step', () => {
    renderWithI18n(<ConfigGuide />);
    fireEvent.click(screen.getByRole('button', { name: '3. 动画与磨砂' }));

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(useSettingsStore.getState().settings.appearance.reducedMotion).toBe(true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'relaxed' } });
    expect(useSettingsStore.getState().settings.appearance.motionSpeed).toBe('relaxed');

    fireEvent.click(screen.getAllByRole('checkbox')[2]);
    expect(useSettingsStore.getState().settings.appearance.floatingGlass).toBe(false);
  });

  it('records the version, closes, and releases the startup gate', async () => {
    renderWithI18n(<ConfigGuide />);
    fireEvent.click(screen.getByRole('button', { name: '3. 动画与磨砂' }));
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.general.lastSeenVersion).toBe(APP_VERSION);
    });
    expect(useConfigGuideStore.getState().isOpen).toBe(false);
    expect(useConfigGuideStore.getState().completedThisSession).toBe(true);
    const persisted = tauriMock.fileStore.get('settings.json')?.get('app') as {
      general: { lastSeenVersion: string | null };
    };
    expect(persisted.general.lastSeenVersion).toBe(APP_VERSION);
  });

  it('still records a non-empty version when the app version is unavailable', async () => {
    vi.spyOn(platform, 'getAppVersion').mockRejectedValueOnce(new Error('no runtime'));
    renderWithI18n(<ConfigGuide />);
    fireEvent.click(screen.getByRole('button', { name: '3. 动画与磨砂' }));
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.general.lastSeenVersion).toBe('unknown');
    });
  });
});

//! dialogs 阶段单测 — 启动弹窗的触发时机与"每会话一次"闸门。
//!
//! 串行规则 (resolveStartupFlow) 已由 phases.test.ts 钉死; 这里只验证:
//! - 设置未加载前不触发任何弹窗动作
//! - 加载完成后: 首次引导按 showOnboarding 弹出且只弹一次
//! - 自动更新检查受串行闸门约束且只发起一次
//! - 录制恢复提示每会话只查一次健康

import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../settings/defaults';
import { api } from '../../../lib/tauri/tauri';
import { notify } from '../../../lib/tauri/notifications';
import { platform } from '../../../lib/platform';
import { useAppStore } from '../../../store/appStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useOnboardingStore } from '../../../store/onboardingStore';
import { useUpdateStore } from '../../../store/updateStore';
import { useStartupDialogs } from '../useStartupDialogs';

let notifyError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    settings: structuredClone(DEFAULT_SETTINGS),
    loaded: false,
    loadError: null,
    keychainPermissionPromptOpen: false,
  });
  useOnboardingStore.setState({ isWizardOpen: false, hasOpenedThisSession: false });
  useUpdateStore.setState({ status: 'idle', dialogOpen: false, lastTrigger: 'manual', updateInfo: null, currentVersion: '', progress: 0, error: null });
  useAppStore.setState({ lang: 'zh' });
  notifyError = vi.spyOn(notify, 'error').mockImplementation(() => 'id');
  vi.spyOn(api, 'getRecordingHealth').mockResolvedValue({
    accepted_batches: 0, accepted_bytes: 0, persisted_batches: 0, persisted_bytes: 0,
    accepted_sequence: 0, persisted_sequence: 0, queued_batches: 0, enabled: true,
    dropped_batches: 0, rejected_batches: 0, warning: null, failed: null,
  });
  vi.spyOn(useUpdateStore.getState(), 'check').mockResolvedValue(undefined);
  vi.spyOn(platform, 'getAppVersion').mockResolvedValue('1.0.0');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useStartupDialogs', () => {
  it('设置未加载前不弹引导, 也不检查更新', async () => {
    await act(async () => {
      renderHook(() => useStartupDialogs());
      await Promise.resolve();
    });
    expect(useOnboardingStore.getState().hasOpenedThisSession).toBe(false);
    expect(useUpdateStore.getState().status).toBe('idle');
  });

  it('设置加载后: showOnboarding 打开则自动弹首次引导, 且只弹一次', async () => {
    useSettingsStore.setState({ loaded: true, settings: { ...useSettingsStore.getState().settings, general: { ...DEFAULT_SETTINGS.general, showOnboarding: true } } });
    await act(async () => {
      renderHook(() => useStartupDialogs());
      await Promise.resolve();
    });
    expect(useOnboardingStore.getState().isWizardOpen).toBe(true);
    expect(useOnboardingStore.getState().hasOpenedThisSession).toBe(true);
  });

  it('设置加载后: showOnboarding 关闭则不弹引导', async () => {
    useSettingsStore.setState({ loaded: true, settings: { ...useSettingsStore.getState().settings, general: { ...DEFAULT_SETTINGS.general, showOnboarding: false } } });
    await act(async () => {
      renderHook(() => useStartupDialogs());
      await Promise.resolve();
    });
    expect(useOnboardingStore.getState().isWizardOpen).toBe(false);
  });

  it('version changes cannot override the disabled onboarding preference', async () => {
    useSettingsStore.setState({ loaded: true, settings: {
      ...useSettingsStore.getState().settings,
      general: { ...DEFAULT_SETTINGS.general, showOnboarding: false, lastSeenVersion: '0.1.0' },
    } });
    await act(async () => {
      renderHook(() => useStartupDialogs());
      await Promise.resolve();
    });
    expect(useOnboardingStore.getState().isWizardOpen).toBe(false);
  });

  it('串行闸门放行后发起一次自动更新检查 (auto) 且不重复', async () => {
    useSettingsStore.setState({ loaded: true, settings: { ...useSettingsStore.getState().settings, general: { ...DEFAULT_SETTINGS.general, showOnboarding: false, autoCheckUpdate: true } } });
    await act(async () => {
      renderHook(() => useStartupDialogs());
      await Promise.resolve();
    });
    const check = useUpdateStore.getState().check as unknown as ReturnType<typeof vi.fn>;
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith('auto');
  });

  it('录制健康每会话只查一次; 有 warning 时发持久错误提示', async () => {
    useSettingsStore.setState({ loaded: true });
    vi.mocked(api.getRecordingHealth).mockResolvedValue({
      accepted_batches: 0, accepted_bytes: 0, persisted_batches: 0, persisted_bytes: 0,
      accepted_sequence: 0, persisted_sequence: 0, queued_batches: 0, enabled: true,
      dropped_batches: 0, rejected_batches: 0, warning: '旧库已被移走', failed: null,
    });
    await act(async () => {
      renderHook(() => useStartupDialogs(), { wrapper: StrictMode });
      await Promise.resolve();
    });
    expect(api.getRecordingHealth).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledTimes(1);
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMock } from '../../test/setup';
import { DEFAULT_SETTINGS, type AppSettings } from '../../settings/defaults';
import { notify } from '../../lib/tauri/notifications';
import { useStartupDialogs } from '../../lib/startup/useStartupDialogs';
import { useOnboardingStore } from '../onboardingStore';
import { useSettingsStore } from '../settingsStore';

const savedSettings = () => tauriMock.fileStore.get('settings.json')?.get('app') as AppSettings;
function seed(showOnboarding: boolean) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.general.showOnboarding = showOnboarding;
  settings.general.autoCheckUpdate = false;
  settings.general.lastSeenVersion = '0.7.1';
  tauriMock.seedFile('settings.json', 'app', settings);
}

beforeEach(async () => {
  await useSettingsStore.getState().save();
  vi.clearAllMocks();
  tauriMock.fileStore.clear();
  notify.dismissAll();
  useSettingsStore.setState({
    settings: structuredClone(DEFAULT_SETTINGS), loaded: false,
    loadError: null, saveError: null, saving: false,
  });
  useOnboardingStore.setState({ isWizardOpen: false, hasOpenedThisSession: false });
});
afterEach(() => vi.restoreAllMocks());

describe('settings persistence and onboarding across sessions', () => {
  it.each(['closeWizard', 'completeWizard'] as const)('%s saves immediately and remains closed after loading again', async (action) => {
    seed(true);
    await useSettingsStore.getState().load();
    const hook = renderHook(() => useStartupDialogs());
    expect(useOnboardingStore.getState().isWizardOpen).toBe(true);
    await act(async () => { await useOnboardingStore.getState()[action](); });
    expect(savedSettings().general.showOnboarding).toBe(false);
    hook.unmount();
    useOnboardingStore.setState({ isWizardOpen: false, hasOpenedThisSession: false });
    await useSettingsStore.getState().load();
    renderHook(() => useStartupDialogs());
    expect(useOnboardingStore.getState().isWizardOpen).toBe(false);
    act(() => useOnboardingStore.getState().openWizard());
    expect(useOnboardingStore.getState().isWizardOpen).toBe(true);
  });

  it('disabling the settings switch saves without waiting for debounce', async () => {
    seed(true);
    await useSettingsStore.getState().load();
    useSettingsStore.getState().update('general', 'showOnboarding', false);
    expect(await useSettingsStore.getState().save()).toBe(true);
    expect(savedSettings().general.showOnboarding).toBe(false);
    expect(tauriMock.settingsSet).toHaveBeenCalledTimes(1);
  });

  it('failed reads block onboarding and every automatic save, then retry the existing settings', async () => {
    seed(false);
    tauriMock.settingsGet.mockRejectedValueOnce(new Error('read denied'));
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState()).toMatchObject({ loaded: true, loadError: 'read denied' });
    renderHook(() => useStartupDialogs());
    expect(useOnboardingStore.getState().isWizardOpen).toBe(false);
    act(() => useSettingsStore.getState().update('general', 'showOnboarding', true));
    expect(await useSettingsStore.getState().save()).toBe(false);
    expect(tauriMock.settingsSet).not.toHaveBeenCalled();
    expect(savedSettings().general.showOnboarding).toBe(false);
    const notice = notify.getList().find((entry) => entry.source === 'settings-load');
    expect(notice?.actions).toHaveLength(1);
    await act(async () => {
      notice?.actions[0].run();
      await vi.waitFor(() => expect(useSettingsStore.getState().loadError).toBeNull());
    });
    expect(useSettingsStore.getState().settings.general.showOnboarding).toBe(false);
    expect(useOnboardingStore.getState().isWizardOpen).toBe(false);
    expect(notify.getList().some((entry) => entry.source === 'settings-load')).toBe(false);
    expect(tauriMock.settingsSet).not.toHaveBeenCalled();
  });

  it('shows a retry action when closing cannot be persisted and retries the latest choice', async () => {
    seed(true);
    await useSettingsStore.getState().load();
    useOnboardingStore.getState().openWizard();
    tauriMock.settingsSet.mockRejectedValueOnce(new Error('disk full'));
    await useOnboardingStore.getState().closeWizard();
    expect(useOnboardingStore.getState().isWizardOpen).toBe(false);
    expect(savedSettings().general.showOnboarding).toBe(true);
    expect(useSettingsStore.getState().saveError).toBe('disk full');
    const notice = notify.getList().find((entry) => entry.source === 'settings-save');
    expect(notice?.actions).toHaveLength(1);
    notice?.actions[0].run();
    expect(await useSettingsStore.getState().save()).toBe(true);
    expect(savedSettings().general.showOnboarding).toBe(false);
    expect(useSettingsStore.getState().saveError).toBeNull();
    expect(notify.getList().some((entry) => entry.source === 'settings-save')).toBe(false);
  });

  it('ignores a stale load after a newer load has completed', async () => {
    seed(false);
    let finishFirst!: (value: AppSettings) => void;
    tauriMock.settingsGet.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    const oldLoad = useSettingsStore.getState().load();
    await useSettingsStore.getState().load();
    finishFirst(structuredClone(DEFAULT_SETTINGS));
    await oldLoad;
    expect(useSettingsStore.getState().settings.general.showOnboarding).toBe(false);
  });
});

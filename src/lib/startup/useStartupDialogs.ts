//! dialogs 阶段 — 启动弹窗编排: 录制恢复提示 / 首次引导 / 自动更新。
//!
//! 串行规则由 `resolveStartupFlow` 统一裁决 (见 `phases.ts`):
//! 首次引导 → 钥匙串授权提醒 → 自动更新; 本 hook 只负责**触发时机**, 弹窗本体
//! 的挂载条件仍在 `App` (懒加载清单)。
//!
//! 每个一次性动作都用 ref 闩住 (每会话一次), 依赖数组只订阅判定所需的最小状态,
//! 避免「设置里无关字段变化 → 重复弹窗」。所有动作都在 `settingsLoaded` 之后:
//! 设置未加载前 `showOnboarding`/`autoCheckUpdate` 是默认值, 提前弹会与真实
//! 用户选择相悖。

import { useEffect, useRef } from 'react';
import { api } from '../tauri/tauri';
import { notify } from '../tauri/notifications';
import { translate } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useUpdateStore } from '../../store/updateStore';
import { resolveStartupFlow } from './phases';

export function useStartupDialogs(): void {
  const settingsLoaded = useSettingsStore((s) => s.loaded && s.loadError === null);
  const lang = useAppStore((s) => s.lang);
  const showOnboarding = useSettingsStore((s) => s.settings.general.showOnboarding);
  const autoCheckUpdate = useSettingsStore((s) => s.settings.general.autoCheckUpdate);
  const keychainPermissionPromptOpen = useSettingsStore((s) => s.keychainPermissionPromptOpen);
  const hasOpenedOnboarding = useOnboardingStore((s) => s.hasOpenedThisSession);
  const isOnboardingOpen = useOnboardingStore((s) => s.isWizardOpen);

  const recordingRecoveryChecked = useRef(false);
  const autoUpdateStarted = useRef(false);
  const onboardingOpened = useRef(false);

  const startupFlow = resolveStartupFlow({
    settingsLoaded,
    showOnboarding,
    hasOpenedOnboarding: hasOpenedOnboarding || onboardingOpened.current,
    isOnboardingOpen,
    keychainPermissionPromptOpen,
    autoCheckUpdate,
  });

  // 首次引导 — 设置加载完成后按 showOnboarding 自动弹出 (每会话一次)
  useEffect(() => {
    const settings = useSettingsStore.getState();
    if (!settings.loaded || settings.loadError !== null) return;
    if (!settingsLoaded || !showOnboarding || hasOpenedOnboarding || onboardingOpened.current) {
      return;
    }
    onboardingOpened.current = true;
    useOnboardingStore.getState().openWizard();
  }, [settingsLoaded, showOnboarding, hasOpenedOnboarding]);

  // 自动检查更新 — 仅一次; 启动弹窗串行闸门放行后才开始; auto 失败不打断用户
  useEffect(() => {
    if (!startupFlow.canCheckForUpdates || autoUpdateStarted.current) return;
    const settings = useSettingsStore.getState();
    if (!settings.loaded || settings.loadError !== null || useOnboardingStore.getState().isWizardOpen) return;
    autoUpdateStarted.current = true;
    void useUpdateStore.getState().check('auto');
  }, [startupFlow.canCheckForUpdates]);

  // 录制恢复提示 (启动页放行后的一次性检查) — 数据库在打开时被自动恢复过
  // (目录重建 / 损坏文件隔离)。必须主动提示: 恢复提示只躺在数据库面板里, 用户
  // 很可能根本没打开那个面板, 于是以为历史凭空消失、录制一直不可用。
  useEffect(() => {
    if (!settingsLoaded || recordingRecoveryChecked.current) return;
    const settings = useSettingsStore.getState();
    if (!settings.loaded || settings.loadError !== null) return;
    recordingRecoveryChecked.current = true;
    void api
      .getRecordingHealth()
      .then((health) => {
        if (health.warning === null) return;
        // 严重级别用 error: 它是**持久**提示 (warn 8 秒自动消失), 而「旧库被移走、
        // 这一段历史读不出来了」必须让用户看见并且来得及看清备份路径。
        // 这只是提示通道的级别, 不是录制故障 — 故障判定只认 `hub.fault()`。
        notify.error(
          translate('recordingDatabaseRecovered', lang),
          health.warning,
          { source: 'recording-recovered' }
        );
      })
      .catch(() => undefined);
  }, [lang, settingsLoaded]);
}

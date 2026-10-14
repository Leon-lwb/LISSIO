export interface StartupFlowState {
  settingsLoaded: boolean;
  /// 配置引导尚未确认 (见 `lib/startup/configGuide`: 全新安装, 或预览开关/远程配置要求)。
  configGuidePending: boolean;
  showOnboarding: boolean;
  hasOpenedOnboarding: boolean;
  isOnboardingOpen: boolean;
  keychainPermissionPromptOpen: boolean;
  autoCheckUpdate: boolean;
}

export interface StartupFlowGate {
  onboardingSettled: boolean;
  showKeychainPermissionPrompt: boolean;
  canCheckForUpdates: boolean;
}

/** 启动弹窗严格串行:配置引导 → 使用引导 → 钥匙串授权提醒 → 自动更新。 */
export function resolveStartupFlow(state: StartupFlowState): StartupFlowGate {
  const onboardingSettled =
    state.settingsLoaded &&
    !state.configGuidePending &&
    !state.isOnboardingOpen &&
    (!state.showOnboarding || state.hasOpenedOnboarding);
  const showKeychainPermissionPrompt =
    onboardingSettled && state.keychainPermissionPromptOpen;

  return {
    onboardingSettled,
    showKeychainPermissionPrompt,
    canCheckForUpdates:
      onboardingSettled &&
      !state.keychainPermissionPromptOpen &&
      state.autoCheckUpdate,
  };
}

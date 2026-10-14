import { describe, expect, it } from 'vitest';
import {
  resolveStartupFlow,
  type StartupFlowState,
} from '../phases';

const READY: StartupFlowState = {
  settingsLoaded: true,
  configGuidePending: false,
  showOnboarding: false,
  hasOpenedOnboarding: false,
  isOnboardingOpen: false,
  keychainPermissionPromptOpen: false,
  autoCheckUpdate: true,
};

describe('resolveStartupFlow', () => {
  it('keeps every later dialog queued while the configuration guide is pending', () => {
    expect(
      resolveStartupFlow({
        ...READY,
        configGuidePending: true,
        showOnboarding: true,
        keychainPermissionPromptOpen: true,
      })
    ).toEqual({
      onboardingSettled: false,
      showKeychainPermissionPrompt: false,
      canCheckForUpdates: false,
    });
  });

  it('keeps keychain and update behind the open onboarding', () => {
    expect(
      resolveStartupFlow({
        ...READY,
        showOnboarding: true,
        hasOpenedOnboarding: true,
        isOnboardingOpen: true,
        keychainPermissionPromptOpen: true,
      })
    ).toEqual({
      onboardingSettled: false,
      showKeychainPermissionPrompt: false,
      canCheckForUpdates: false,
    });
  });

  it('shows the keychain prompt after onboarding and keeps updates queued', () => {
    expect(
      resolveStartupFlow({
        ...READY,
        showOnboarding: true,
        hasOpenedOnboarding: true,
        keychainPermissionPromptOpen: true,
      })
    ).toEqual({
      onboardingSettled: true,
      showKeychainPermissionPrompt: true,
      canCheckForUpdates: false,
    });
  });

  it('keeps all later dialogs queued while a manually replayed guide is open', () => {
    expect(resolveStartupFlow({
      ...READY, isOnboardingOpen: true, hasOpenedOnboarding: true,
      keychainPermissionPromptOpen: true,
    })).toEqual({
      onboardingSettled: false, showKeychainPermissionPrompt: false, canCheckForUpdates: false,
    });
    expect(resolveStartupFlow({ ...READY, isOnboardingOpen: true }).canCheckForUpdates).toBe(false);
  });

  it('allows auto update only after earlier startup dialogs settle', () => {
    expect(resolveStartupFlow(READY)).toEqual({
      onboardingSettled: true,
      showKeychainPermissionPrompt: false,
      canCheckForUpdates: true,
    });
  });
});

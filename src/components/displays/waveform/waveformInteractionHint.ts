import { useAppStore } from '../../../store/appStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useOnboardingStore } from '../../../store/onboardingStore';
import { notify } from '../../../lib/tauri/notifications';
import { t } from '../../../i18n';

/// Show the one-time waveform interaction hint when context tips are enabled.
export function maybeShowInteractHint(): void {
  if (!useSettingsStore.getState().settings.general.showContextualTips) return;
  const state = useOnboardingStore.getState();
  if (state.waveformInteractHintShown) return;
  state.markWaveformInteractHintShown();
  const lang = useAppStore.getState().lang;
  notify.info(
    t(lang, 'waveformInteractHintTitle'),
    t(lang, 'waveformInteractHintMessage'),
    { actions: [{ label: t(lang, 'closeHintGotIt'), run: () => undefined }] }
  );
}

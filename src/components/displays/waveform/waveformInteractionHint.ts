import { useAppStore } from '../../../store/appStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useOnboardingStore } from '../../../store/onboardingStore';
import { notify } from '../../../lib/tauri/notifications';
import { translate } from '../../../i18n';

/// Show the one-time waveform interaction hint when context tips are enabled.
export function maybeShowInteractHint(): void {
  if (!useSettingsStore.getState().settings.general.showContextualTips) return;
  const state = useOnboardingStore.getState();
  if (state.waveformInteractHintShown) return;
  state.markWaveformInteractHintShown();
  const lang = useAppStore.getState().lang;
  notify.info(
    translate('waveformInteractHintTitle', lang),
    translate('waveformInteractHintMessage', lang),
    { actions: [{ label: translate('closeHintGotIt', lang), run: () => undefined }] }
  );
}

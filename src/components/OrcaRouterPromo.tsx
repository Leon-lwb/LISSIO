import { ExternalLink, Sparkles } from 'lucide-react';

import { translate } from '../i18n';
import { platform } from '../lib/platform';
import { ORCAROUTER_OFFERS_URL, ORCAROUTER_REFERRAL_URL } from '../settings/defaults';
import { useAppStore } from '../store/appStore';

/** OrcaRouter acquisition and free-model shortcuts shown beside API Key. */
export function OrcaRouterPromo() {
  const lang = useAppStore((state) => state.lang);
  return (
    <div className="my-2 px-3 py-2 rounded border border-accent/25 bg-accent/5 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 text-xs text-text-secondary leading-relaxed">
          {translate('settingAiOrcaHint', lang)}
        </span>
        <button
          className="flex-shrink-0 px-2 py-1 rounded bg-accent text-accent-foreground text-xs flex items-center gap-1"
          onClick={() => void platform.openUrl(ORCAROUTER_REFERRAL_URL)}
        >
          <ExternalLink size={11} />
          {translate('settingAiOrcaGetKey', lang)}
        </button>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-text-secondary leading-relaxed">
        <Sparkles size={11} className="flex-shrink-0 text-accent" />
        <span className="flex-shrink-0">{translate('settingAiOrcaFreeModels', lang)}</span>
        <button
          className="text-accent hover:text-accent-hover hover:underline truncate text-left"
          onClick={() => void platform.openUrl(ORCAROUTER_OFFERS_URL)}
          title={ORCAROUTER_OFFERS_URL}
        >
          {ORCAROUTER_OFFERS_URL}
        </button>
      </div>
    </div>
  );
}

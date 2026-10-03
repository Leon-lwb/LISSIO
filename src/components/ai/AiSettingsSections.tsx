import type { ReactNode } from 'react';
import { ChevronRight, Globe2, Network, Puzzle } from 'lucide-react';

import { t } from '../../i18n';
import type { AppSettings } from '../../settings/defaults';
import { useAppStore } from '../../store/appStore';

type AiUpdate = (field: keyof AppSettings['ai'], value: boolean) => void;

interface AiSettingsSectionsProps {
  settings: AppSettings;
  update: AiUpdate;
  onOpenPlugins: () => void;
  onOpenMcp: () => void;
}

interface SectionLinkProps {
  icon: ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  openLabel: string;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
}

function SectionLink({
  icon,
  title,
  description,
  enabled,
  openLabel,
  onToggle,
  onOpen,
}: SectionLinkProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-bg-hover text-text-secondary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary">{title}</div>
        <div className="text-xs leading-relaxed text-text-secondary">{description}</div>
      </div>
      <label className="settings-toggle" title={title}>
        <span className="sr-only">{title}</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span className="settings-toggle-slider" />
      </label>
      <button
        type="button"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        onClick={onOpen}
        aria-label={openLabel}
        title={openLabel}
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

/** AI first-level section links; their master switches stay on this page. */
export function AiSettingsSections({
  settings,
  update,
  onOpenPlugins,
  onOpenMcp,
}: AiSettingsSectionsProps) {
  const lang = useAppStore((state) => state.lang);
  return (
    <section className="mt-4">
      <div className="section-heading pb-2">{t(lang, 'settingsAiSections')}</div>
      <SectionLink
        icon={<Puzzle size={16} />}
        title={t(lang, 'settingAiPlugins')}
        description={t(lang, 'settingAiPluginsDesc')}
        enabled={settings.ai.pluginsEnabled}
        openLabel={t(lang, 'settingsOpenPlugins')}
        onToggle={(value) => update('pluginsEnabled', value)}
        onOpen={onOpenPlugins}
      />
      <SectionLink
        icon={<Network size={16} />}
        title={t(lang, 'settingAiMcp')}
        description={t(lang, 'settingAiMcpDesc')}
        enabled={settings.ai.mcpToolsEnabled}
        openLabel={t(lang, 'settingsOpenMcp')}
        onToggle={(value) => update('mcpToolsEnabled', value)}
        onOpen={onOpenMcp}
      />
    </section>
  );
}

interface AiPluginSettingsProps {
  settings: AppSettings;
  update: AiUpdate;
}

interface PluginCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}

function PluginCard({
  icon,
  title,
  description,
  enabled,
  disabled,
  onChange,
}: PluginCardProps) {
  return (
    <div className={`flex items-start gap-3 rounded border border-border-subtle p-3 ${disabled ? 'opacity-disabled' : ''}`}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-bg-hover text-text-secondary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-text-secondary">{description}</div>
      </div>
      <label className="settings-toggle" title={title}>
        <span className="sr-only">{title}</span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="settings-toggle-slider" />
      </label>
    </div>
  );
}

/** Plugin inventory shown at AI > Plugins. */
export function AiPluginSettings({ settings, update }: AiPluginSettingsProps) {
  const lang = useAppStore((state) => state.lang);
  const disabled = !settings.ai.pluginsEnabled;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-text-primary">{t(lang, 'settingAiPlugins')}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
          {disabled
            ? t(lang, 'settingAiPluginMasterDisabled')
            : t(lang, 'settingAiPluginsDesc')}
        </p>
      </div>
      <PluginCard
        icon={<Puzzle size={16} />}
        title={t(lang, 'settingAiBuiltinTools')}
        description={t(lang, 'settingAiBuiltinToolsDesc')}
        enabled={settings.ai.builtinToolsEnabled}
        disabled={disabled}
        onChange={(value) => update('builtinToolsEnabled', value)}
      />
      <PluginCard
        icon={<Globe2 size={16} />}
        title={t(lang, 'settingAiWebTools')}
        description={t(lang, 'settingAiWebToolsDesc')}
        enabled={settings.ai.webToolsEnabled}
        disabled={disabled}
        onChange={(value) => update('webToolsEnabled', value)}
      />
    </section>
  );
}

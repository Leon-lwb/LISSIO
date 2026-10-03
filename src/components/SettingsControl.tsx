import { FolderOpen, Pencil } from 'lucide-react';
import { platform } from '../lib/platform';
import { transport } from '../lib/rpc';
import { useAppStore } from '../store/appStore';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import type { AppSettings } from '../settings/defaults';
import { BUILT_IN_THEMES, type ThemeDefinition } from '../settings/theme';
import type { SettingFieldDef } from './settingFields';
import { DraftInput, DraftNumberInput, OpacitySliderControl } from './ui/fields';
import { formatError, notify } from '../lib/tauri/notifications';

interface SettingsControlProps {
  def: SettingFieldDef;
  settings: AppSettings;
  update: (category: keyof AppSettings, field: string, value: unknown) => void;
  setLang: (lang: Lang) => void;
  onEditTheme: () => void;
}

export function SettingsControl({ def, settings, update, setLang, onEditTheme }: SettingsControlProps) {
  const lang = useAppStore((s) => s.lang);
  const category = def.category;
    const value = (settings[category] as Record<string, unknown>)[def.field];

    const handleChange = (v: unknown) => {
      // 设置项的 category+field 组合来自 SETTING_FIELDS 静态表, 类型保证安全
      // 但 TypeScript 无法静态推断, 此处用 type assertion
      update(
        category,
        def.field,
        v
      );
      // 语言切换同步到 appStore
      if (category === 'general' && def.field === 'language') {
        setLang(v as Lang);
      }
    };

    const ctrl = def.control;
    switch (ctrl.kind) {
      case 'toggle':
        return (
          <label className="settings-toggle">
            <span className="sr-only">{def.field}</span>
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleChange(e.target.checked)}
            />
            <span className="settings-toggle-slider" />
          </label>
        );
      case 'select':
        return (
          <select
            className="w-full px-2 py-1 bg-bg-input text-text-primary border border-border rounded text-sm focus:outline-none focus:border-accent transition-colors cursor-pointer min-w-[140px]"
            value={String(value)}
            onChange={(e) => {
              const opt = ctrl.options.find((o) => String(o.value) === e.target.value);
              if (opt) handleChange(opt.value);
            }}
          >
            {ctrl.options.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case 'number':
        return (
          <DraftNumberInput
            className="w-full px-2 py-1 bg-bg-input text-text-primary border border-border rounded text-sm font-ui focus:outline-none focus:border-accent transition-colors w-[120px]"
            value={typeof value === 'number' ? value : null}
            min={ctrl.min}
            max={ctrl.max}
            step={ctrl.step}
            onCommit={(n) => handleChange(n)}
          />
        );
      case 'slider':
        return (
          <OpacitySliderControl
            value={typeof value === 'number' ? value : ctrl.min}
            min={ctrl.min}
            max={ctrl.max}
            step={ctrl.step}
            label={t(lang, def.labelKey)}
            onCommit={(n) => handleChange(n)}
          />
        );
      case 'text':
        return (
          <DraftInput
            type="text"
            className="w-full px-2 py-1 bg-bg-input text-text-primary border border-border rounded text-sm font-ui focus:outline-none focus:border-accent transition-colors"
            value={String(value)}
            onCommit={handleChange}
          />
        );
      case 'path':
        return (
          <div className="flex items-center gap-2 min-w-[240px]">
            <DraftInput
              type="text"
              className="flex-1 min-w-0 px-2 py-1 bg-bg-input text-text-primary border border-border rounded text-sm font-ui focus:outline-none focus:border-accent transition-colors"
              value={typeof value === 'string' ? value : ''}
              placeholder={t(lang, 'settingRecDefaultDir')}
              onCommit={handleChange}
            />
            <button
              className="flex-shrink-0 px-2 py-1 bg-bg-input text-text-primary border border-border rounded text-sm hover:bg-bg-hover hover:text-text-bright transition-colors cursor-pointer inline-flex items-center gap-1"
              onClick={() => {
                void platform.openFile({
                  directory: true,
                  title: t(lang, 'settingRecDatabaseDir'),
                }).then((dir) => {
                  if (typeof dir === 'string' && dir) handleChange(dir);
                });
              }}
              title={t(lang, 'settingRecBrowse')}
            >
              <FolderOpen size={12} />
              <span>{t(lang, 'settingRecBrowse')}</span>
            </button>
          </div>
        );
      case 'openSettingsFolder':
        return (
          <button
            type="button"
            className="px-2 py-1 bg-bg-input text-text-primary border border-border rounded text-sm hover:bg-bg-hover hover:text-text-bright transition-colors cursor-pointer inline-flex items-center gap-1"
            onClick={() => {
              void transport.call<void>('open_settings_folder').catch((error: unknown) => {
                notify.error(t(lang, 'settingAiOpenSettingsFolderFailed'), formatError(error), {
                  source: 'settings-folder',
                });
              });
            }}
            title={t(lang, 'settingAiOpenSettingsFolder')}
          >
            <FolderOpen size={12} />
            <span>{t(lang, 'settingAiOpenSettingsFolder')}</span>
          </button>
        );
      case 'theme': {
        const themeOptions = [
          ...BUILT_IN_THEMES.map((t) => ({ value: t.id, label: t.name })),
          ...settings.appearance.customThemes.map((t: ThemeDefinition) => ({
            value: t.id,
            label: t.name,
          })),
        ];
        return (
          <div className="flex items-center gap-2 min-w-[220px]">
            <select
              className="flex-1 px-2 py-1 bg-bg-input text-text-primary border border-border rounded text-sm focus:outline-none focus:border-accent transition-colors cursor-pointer"
              value={String(value)}
              onChange={(e) => {
                const opt = themeOptions.find((o) => o.value === e.target.value);
                if (opt) handleChange(opt.value);
              }}
            >
              {themeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              className="px-2 py-1 bg-bg-input text-text-primary border border-border rounded text-sm hover:bg-bg-hover hover:text-text-bright transition-colors cursor-pointer inline-flex items-center gap-1"
              onClick={() => onEditTheme()}
              title={t(lang, 'themeEdit')}
            >
              <Pencil size={12} />
              <span>{t(lang, 'themeEdit')}</span>
            </button>
          </div>
        );
      }
    }

}

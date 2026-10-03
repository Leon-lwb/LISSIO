import { Database, Download, RotateCcw, Upload } from 'lucide-react';

import { t } from '../i18n';
import { exportAppToFile, importAppFromFile } from '../lib/tauri/appExport';
import { activateOnKeyboard } from '../lib/utils/a11y';
import type { AppSettings } from '../settings/defaults';
import { useAppStore } from '../store/appStore';
import { CATEGORY_ICONS, CATEGORY_LABEL_KEY } from './settingsCategories';

interface SettingsSidebarNavigationProps {
  activeCategory: keyof AppSettings;
  searchQuery: string;
  onSelectCategory: (category: keyof AppSettings) => void;
  onOpenBackup: () => void;
}

/** Category and backup controls owned by the settings sidebar. */
export function SettingsSidebarNavigation({
  activeCategory,
  searchQuery,
  onSelectCategory,
  onOpenBackup,
}: SettingsSidebarNavigationProps) {
  const lang = useAppStore((state) => state.lang);
  return (
    <>
      {(Object.keys(CATEGORY_LABEL_KEY) as (keyof AppSettings)[]).map((category) => {
        const isActive = !searchQuery.trim() && activeCategory === category;
        return (
          <div
            key={category}
            className={`flex items-center gap-2.5 px-4 py-2 text-text-secondary text-sm cursor-pointer transition-all duration-150 border-l-2 border-transparent hover:bg-bg-hover hover:text-text-primary ${isActive ? 'text-text-bright bg-bg-hover border-l-accent' : ''}`}
            onClick={() => onSelectCategory(category)}
            onKeyDown={activateOnKeyboard}
            role="button"
            tabIndex={0}
          >
            {CATEGORY_ICONS[category]}
            <span>{t(lang, CATEGORY_LABEL_KEY[category])}</span>
          </div>
        );
      })}
      <div className="flex-1" />
      <div className="mt-2 border-t border-border px-4 pt-2 pb-1">
        <div className="section-heading mb-1">{t(lang, 'backupCategory')}</div>
        <button
          className="w-full flex items-center gap-2.5 py-1.5 text-text-secondary text-sm cursor-pointer transition-all duration-150 hover:text-text-bright"
          onClick={() => void exportAppToFile()}
          title={t(lang, 'exportConfig')}
        >
          <Download size={14} />
          <span>{t(lang, 'exportConfig')}</span>
        </button>
        <button
          className="w-full flex items-center gap-2.5 py-1.5 text-text-secondary text-sm cursor-pointer transition-all duration-150 hover:text-text-bright"
          onClick={() => void importAppFromFile()}
          title={t(lang, 'importConfig')}
        >
          <Upload size={14} />
          <span>{t(lang, 'importConfig')}</span>
        </button>
        <button
          className="w-full flex items-center gap-2.5 py-1.5 text-text-secondary text-sm cursor-pointer transition-all duration-150 hover:text-text-bright"
          onClick={onOpenBackup}
          title={t(lang, 'backupCustom')}
        >
          <Database size={14} />
          <span>{t(lang, 'backupCustom')}</span>
        </button>
      </div>
    </>
  );
}

export function SettingsResetButton({ onClick }: { onClick: () => void }) {
  const lang = useAppStore((state) => state.lang);
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2 text-text-secondary text-sm cursor-pointer transition-all duration-150 border-l-2 border-transparent hover:bg-bg-hover hover:text-text-primary"
      onClick={onClick}
      onKeyDown={activateOnKeyboard}
      role="button"
      tabIndex={0}
      title={t(lang, 'settingsReset')}
    >
      <RotateCcw size={14} />
      <span>{t(lang, 'settingsReset')}</span>
    </div>
  );
}

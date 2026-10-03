//! VSCode 风格设置弹窗
//!
//! - 左侧分组导航 (General/Appearance/Editor/Serial/Notifications)
//! - 顶部搜索框 (实时过滤)
//! - 右侧表单 (标题 + 描述 + 控件)
//! - 底部 Reset / Done 按钮
//! - ESC 关闭, 点击遮罩关闭

import { Fragment, useEffect, useMemo, useRef, useState, useActionState } from 'react';
import { activateOnKeyboard } from '../lib/utils/a11y';
import {
  X,
  RotateCcw,
  Check,
  Type,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { platform } from '../lib/platform';
import { hasTauriRuntime } from '../lib/rpc';
import { useSettingsStore } from '../store/settingsStore';
import { useAppStore } from '../store/appStore';
import { t } from '../i18n';
import type { AppSettings } from '../settings/defaults';
import { ThemeEditor } from './ThemeEditor';
import type { SettingFieldDef} from './settingFields';
import { buildSettingFields } from './settingFields';
import { useModelCatalogStore } from '../store/modelCatalogStore';
import { formatError } from '../lib/tauri/notifications';
import { BackupModal } from './BackupModal';
import { useUpdateStore, type UpdateChannel } from '../store/updateStore';
import { SearchInput } from './ui/SearchInput';
import { DialogHeader, DialogOverlay, DialogSurface } from './ui/Dialog';
import { AiMcpSettings } from './ai/AiMcpSettings';
import { AiPluginSettings, AiSettingsSections } from './ai/AiSettingsSections';
import { SettingsControl } from './SettingsControl';
import { UpdateChannelDialog } from './UpdateChannelDialog';
import { CATEGORY_LABEL_KEY } from './settingsCategories';
import { OrcaRouterPromo } from './OrcaRouterPromo';
import {
  SettingsResetButton,
  SettingsSidebarNavigation,
} from './SettingsSidebarSections';

type AiSection = 'main' | 'plugins' | 'mcp';

const AI_SECTION_FIELDS: Record<Exclude<AiSection, 'main'>, ReadonlySet<string>> = {
  plugins: new Set(['builtinToolsEnabled', 'webToolsEnabled']),
  mcp: new Set(['mcpServerPort']),
};

const AI_NAV_FIELDS = new Set(['pluginsEnabled', 'mcpToolsEnabled']);

export function SettingsModal() {
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);
  const isOpen = useSettingsStore((s) => s.isOpen);
  const close = useSettingsStore((s) => s.close);
  const settings = useSettingsStore((s) => s.settings);
  const activeCategory = useSettingsStore((s) => s.activeCategory);
  const searchQuery = useSettingsStore((s) => s.searchQuery);
  const setActiveCategory = useSettingsStore((s) => s.setActiveCategory);
  const setSearchQuery = useSettingsStore((s) => s.setSearchQuery);
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);
  const resetCategory = useSettingsStore((s) => s.resetCategory);
  const [themeEditorOpen, setThemeEditorOpen] = useState(false);
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [aiSection, setAiSection] = useState<AiSection>('main');
  const [appVersion, setAppVersion] = useState('');
  /// 更新状态 — 与状态栏/更新弹窗共享 updateStore
  const updateStatus = useUpdateStore((s) => s.status);
  const updateInfo = useUpdateStore((s) => s.updateInfo);
  const updateProgress = useUpdateStore((s) => s.progress);
  const updateError = useUpdateStore((s) => s.error);
  const checkForUpdate = useUpdateStore((s) => s.check);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);
  const relaunchApp = useUpdateStore((s) => s.relaunch);
  const setUpdateChannel = useUpdateStore((s) => s.setChannel);
  const updateChannel = useSettingsStore((s) => s.settings.general.updateChannel);
  /// 待确认的通道切换 (非空时显示确认框)
  const [pendingChannel, setPendingChannel] = useState<UpdateChannel | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // 读取当前应用版本
  useEffect(() => {
    void platform.getAppVersion().then(setAppVersion).catch(() => setAppVersion(''));
  }, []);

  // ESC 关闭 + 自动聚焦搜索框
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    // 延迟聚焦避免与打开动画冲突
    const t = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', handler);
      clearTimeout(t);
    };
  }, [isOpen, close]);

  // 设置项清单 — AI provider 选项来自模型目录 (aiProvider 家族)
  const catalogModels = useModelCatalogStore((s) => s.models);
  const settingFields = useMemo(() =>
    buildSettingFields(catalogModels).filter((field) =>
      hasTauriRuntime() || field.control.kind !== 'openSettingsFolder'
    ), [catalogModels]);

  // 搜索过滤
  const filteredFields = useMemo(() => {
    const searchActive = searchQuery.trim().length > 0;
    const baseFields = activeCategory === 'ai' && !searchActive
      ? settingFields.filter((field) =>
          !AI_NAV_FIELDS.has(field.field)
          && !Object.values(AI_SECTION_FIELDS).some((fields) => fields.has(field.field))
        )
      : settingFields;
    if (!searchActive) return baseFields;
    const q = searchQuery.toLowerCase();
    return baseFields.filter((f) => {
      const label = t(lang, f.labelKey).toLowerCase();
      const desc = t(lang, f.descKey).toLowerCase();
      const category = t(lang, CATEGORY_LABEL_KEY[f.category]).toLowerCase();
      return (
        label.includes(q) ||
        desc.includes(q) ||
        category.includes(q) ||
        f.field.toLowerCase().includes(q) ||
        (f.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false)
      );
    });
  }, [activeCategory, lang, searchQuery, settingFields]);

  // 按分类分组
  const groupedFields = useMemo(() => {
    const groups: Partial<Record<keyof AppSettings, SettingFieldDef[]>> = {};
    for (const f of filteredFields) {
      (groups[f.category] ??= []).push(f);
    }
    return groups;
  }, [filteredFields]);

  // Done / Reset Category 提交 action — 包装现有 store action, isPending 禁用按钮
  const [saveState, saveAction, isSaving] = useActionState<{ ok: boolean; error?: string }>(
    () => {
      try {
        close();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: formatError(e) };
      }
    },
    { ok: true }
  );

  const [resetCategoryState, resetCategoryAction, isResettingCategory] = useActionState<{ ok: boolean; error?: string }>(
    () => {
      try {
        resetCategory(activeCategory);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: formatError(e) };
      }
    },
    { ok: true }
  );

  if (!isOpen) return null;

  // 更新按钮行为与状态文案
  const updateBusy = updateStatus === 'checking' || updateStatus === 'downloading';
  const updateLabel =
    updateStatus === 'checking'
      ? t(lang, 'updateChecking')
      : updateStatus === 'available' && updateInfo
        ? `${t(lang, 'updateDownload')} v${updateInfo.version}`
        : updateStatus === 'downloading'
          ? `${t(lang, 'updateDownloading')} ${updateProgress}%`
          : updateStatus === 'ready'
            ? t(lang, 'updateRelaunch')
            : t(lang, 'updateCheck');
  const handleUpdateClick = () => {
    if (updateStatus === 'ready') void relaunchApp();
    else if (updateStatus === 'available') void downloadAndInstall();
    else if (!updateBusy) void checkForUpdate('manual');
  };

  // 更新通道显示值 — 未显式设置时按当前版本推导 (含 '-' 视为预发布)
  const effectiveChannel: UpdateChannel =
    updateChannel ?? (appVersion.includes('-') ? 'beta' : 'stable');

  const renderControl = (def: SettingFieldDef) => (
    <SettingsControl
      def={def}
      settings={settings}
      update={(category, field, value) =>
        (update as (c: keyof AppSettings, f: string, v: unknown) => void)(category, field, value)
      }
      setLang={setLang}
      onEditTheme={() => setThemeEditorOpen(true)}
    />
  );
  const updateAiBoolean = (field: keyof AppSettings['ai'], value: boolean) => {
    (update as (c: keyof AppSettings, f: string, v: unknown) => void)('ai', field, value);
  };
  const aiSectionLabel = aiSection === 'plugins'
    ? t(lang, 'settingsAiSectionPlugins')
    : aiSection === 'mcp'
      ? t(lang, 'settingsAiSectionMcp')
      : null;

  return (
    <DialogOverlay
      className="animate-[settings-fade-in_0.15s_ease-out]"
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      onKeyDown={activateOnKeyboard}
      role="button"
      tabIndex={0}
    >
      <DialogSurface
        className="w-[820px] max-w-[92vw] h-[600px] max-h-[88vh] animate-[settings-slide-in_0.2s_ease-out]"
        label={t(lang, 'settingsTitle')}
      >
        {/* 顶部 — 标题 + 搜索框 + 关闭 */}
        <DialogHeader className="gap-3">
          <div className="flex items-center gap-1.5 text-text-bright text-base font-semibold flex-shrink-0">
            <Type size={16} />
            <span>{t(lang, 'settingsTitle')}</span>
          </div>
          {/* ESC 先清空搜索, 空值才冒泡到 window 关闭弹窗 (SearchInput 内处理) */}
          <SearchInput
            size="md"
            className="flex-1"
            inputRef={searchInputRef}
            placeholder={t(lang, 'settingsSearch')}
            value={searchQuery}
            onChange={(value) => {
              setAiSection('main');
              setSearchQuery(value);
            }}
          />
          <button className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer" onClick={close} title={t(lang, 'settingsClose')}>
            <X size={16} />
          </button>
        </DialogHeader>

        {/* 主体 — 左侧分类 + 右侧表单 */}
        <div className="flex-1 flex min-h-0">
          <div className="w-50 dialog-chrome-muted border-r border-border py-2 flex flex-col flex-shrink-0 overflow-y-auto">
            <SettingsSidebarNavigation
              activeCategory={activeCategory}
              searchQuery={searchQuery}
              onSelectCategory={(category) => {
                setActiveCategory(category);
                setSearchQuery('');
                setAiSection('main');
              }}
              onOpenBackup={() => setBackupModalOpen(true)}
            />
            <div className="mt-2 border-t border-border px-4 pt-2 pb-1">
              <div className="section-heading mb-1">
                {t(lang, 'updateCategory')}
              </div>
              {appVersion && (
                <div className="text-xs text-text-secondary pb-1">
                  {t(lang, 'updateCurrentVersion')}: v{appVersion}
                </div>
              )}
              <button
                className={`w-full flex items-center gap-2.5 py-1.5 text-text-secondary text-sm transition-all duration-150 ${
                  updateBusy ? 'opacity-muted cursor-wait' : 'cursor-pointer hover:text-text-bright'
                }`}
                onClick={handleUpdateClick}
                disabled={updateBusy}
                title={updateLabel}
              >
                <RefreshCw size={14} className={updateBusy ? 'animate-spin' : ''} />
                <span>{updateLabel}</span>
              </button>
              <div className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-xs text-text-secondary" title={t(lang, 'updateChannelDesc')}>
                  {t(lang, 'updateChannel')}
                </span>
                <select
                  className="px-2 py-0.5 bg-bg-input text-text-primary border border-border rounded text-xs focus:outline-none focus:border-accent transition-colors cursor-pointer"
                  value={effectiveChannel}
                  onChange={(e) => {
                    const next = e.target.value as UpdateChannel;
                    if (next !== effectiveChannel) setPendingChannel(next);
                  }}
                >
                  <option value="stable">{t(lang, 'updateChannelStable')}</option>
                  <option value="beta">{t(lang, 'updateChannelBeta')}</option>
                </select>
              </div>
              {updateStatus === 'downloading' && (
                <div className="h-1 rounded-full bg-bg-hover overflow-hidden mb-1">
                  <div
                    className="h-full bg-accent transition-all duration-200"
                    style={{ width: `${updateProgress}%` }}
                  />
                </div>
              )}
              {updateStatus === 'up-to-date' && (
                <div className="text-xs text-text-secondary pb-1">{t(lang, 'updateUpToDate')}</div>
              )}
              {updateStatus === 'ready' && (
                <div className="text-xs text-text-secondary pb-1">{t(lang, 'updateReady')}</div>
              )}
              {updateStatus === 'error' && updateError && (
                <div className="text-xs text-text-danger pb-1 break-all">
                  {t(lang, 'updateError')}: {updateError}
                </div>
              )}
            </div>
            <SettingsResetButton onClick={reset} />
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 bg-bg-editor">
            {activeCategory === 'ai' && !searchQuery.trim() && (
              <nav
                className="flex items-center gap-1.5 pb-3 text-xs text-text-secondary"
                aria-label={t(lang, 'settingsBreadcrumb')}
              >
                <span>{t(lang, 'settingsTitle')}</span>
                <ChevronRight size={12} aria-hidden="true" />
                <button
                  type="button"
                  className={aiSection === 'main' ? 'text-text-primary' : 'hover:text-text-primary'}
                  onClick={() => setAiSection('main')}
                >
                  {t(lang, CATEGORY_LABEL_KEY.ai)}
                </button>
                {aiSectionLabel && (
                  <>
                    <ChevronRight size={12} aria-hidden="true" />
                    <span className="text-text-primary">{aiSectionLabel}</span>
                  </>
                )}
              </nav>
            )}
            {activeCategory === 'ai' && !searchQuery.trim() && aiSection === 'plugins' ? (
              <AiPluginSettings settings={settings} update={updateAiBoolean} />
            ) : activeCategory === 'ai' && !searchQuery.trim() && aiSection === 'mcp' ? (
              <AiMcpSettings
                port={settings.ai.mcpServerPort}
                onPortChange={(value) =>
                  (update as (c: keyof AppSettings, f: string, v: unknown) => void)(
                    'ai',
                    'mcpServerPort',
                    value
                  )
                }
              />
            ) : (Object.keys(groupedFields) as (keyof AppSettings)[]).map((cat) => {
              const fields = groupedFields[cat]!;
              // 搜索模式下显示分类标题; 非搜索模式只显示当前分类
              if (!searchQuery.trim() && cat !== activeCategory) return null;
              return (
                <div key={cat} className="mb-6">
                  {searchQuery.trim() && (
                    <div className="section-heading pb-2 mb-3 border-b border-border">
                      {t(lang, CATEGORY_LABEL_KEY[cat])}
                    </div>
                  )}
                  {fields.map((def) => (
                    <Fragment key={`${def.category}-${def.field}`}>
                      <div className="flex items-start justify-between gap-6 py-2.5 border-b border-border last:border-b-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary mb-0.5">{t(lang, def.labelKey)}</div>
                          <div className="text-xs text-text-secondary leading-relaxed">{t(lang, def.descKey)}</div>
                        </div>
                        <div className="flex-shrink-0 min-w-[200px] flex items-center justify-end">{renderControl(def)}</div>
                      </div>
                      {cat === 'ai' && def.field === 'apiKey' && settings.ai.adapter === 'orcarouter' && <OrcaRouterPromo />}
                    </Fragment>
                  ))}
                  {cat === 'ai' && !searchQuery.trim() && aiSection === 'main' && (
                    <AiSettingsSections
                      settings={settings}
                      update={updateAiBoolean}
                      onOpenPlugins={() => setAiSection('plugins')}
                      onOpenMcp={() => setAiSection('mcp')}
                    />
                  )}
                </div>
              );
            })}
            {!searchQuery.trim() && (
              <form action={resetCategoryAction} className="py-4">
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-transparent text-text-secondary border-none rounded cursor-pointer text-sm text-center transition-colors hover:bg-bg-hover hover:text-text-primary inline-flex items-center gap-1.5 disabled:opacity-disabled disabled:cursor-default"
                  disabled={isResettingCategory}
                >
                  <RotateCcw size={12} />
                  <span>{t(lang, 'settingsResetCategory')}</span>
                </button>
                {resetCategoryState.error && (
                  <div className="text-xs text-text-danger break-all">{resetCategoryState.error}</div>
                )}
              </form>
            )}
          </div>
        </div>

        {/* 底部 — 完成按钮 */}
        <div className="flex items-center px-4 py-2.5 border-t border-border dialog-chrome flex-shrink-0">
          <div className="flex-1" />
          <form action={saveAction}>
            <button
              type="submit"
              className="bg-bg-button text-text-inverse border-none py-1.5 px-4 text-sm font-ui cursor-pointer rounded inline-flex items-center gap-1.5 transition-colors hover:bg-bg-button-hover disabled:opacity-disabled disabled:cursor-default"
              disabled={isSaving}
            >
              <Check size={14} />
              <span>{t(lang, 'settingsDone')}</span>
            </button>
            {saveState.error && (
              <div className="text-xs text-text-danger break-all">{saveState.error}</div>
            )}
          </form>
        </div>
      </DialogSurface>
      <ThemeEditor
        isOpen={themeEditorOpen}
        onClose={() => setThemeEditorOpen(false)}
        themes={settings.appearance.customThemes}
        onThemesChange={(themes) =>
          (update as (c: keyof AppSettings, f: string, v: unknown) => void)(
            'appearance',
            'customThemes',
            themes
          )
        }
        activeThemeId={String(settings.appearance.theme)}
        onActiveThemeChange={(id) =>
          (update as (c: keyof AppSettings, f: string, v: unknown) => void)(
            'appearance',
            'theme',
            id
          )
        }
        cssThemes={settings.appearance.customCssThemes}
        onCssThemesChange={(themes) =>
          (update as (c: keyof AppSettings, f: string, v: unknown) => void)(
            'appearance',
            'customCssThemes',
            themes
          )
        }
        activeCssThemeId={String(settings.appearance.cssTheme)}
        onActiveCssThemeChange={(id) =>
          (update as (c: keyof AppSettings, f: string, v: unknown) => void)(
            'appearance',
            'cssTheme',
            id
          )
        }
      />
      <BackupModal isOpen={backupModalOpen} onClose={() => setBackupModalOpen(false)} />
      <UpdateChannelDialog
        pendingChannel={pendingChannel}
        setPendingChannel={setPendingChannel}
        setUpdateChannel={setUpdateChannel}
      />

    </DialogOverlay>
  );
}

/// 懒加载入口 — 见 `components/lazy/lazyComponents.ts` (全仓唯一 React.lazy 清单)。
export default SettingsModal;

//! 主题编辑器弹窗
//!
//! - Tab切换: 颜色主题 / CSS样式主题
//! - 左侧主题列表 (内置 + 自定义)
//! - 右侧颜色 token 网格 或 CSS主题管理
//! - 支持新建/复制/重命名/删除自定义主题

import { useEffect, useMemo, useRef, useState } from 'react';
import { activateOnKeyboard } from '../lib/utils/a11y';
import {
  X,
  Plus,
  Check,
  Palette,
  FileCode,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { t } from '../i18n';
import {
  BUILT_IN_THEMES,
  BUILT_IN_CSS_THEMES,
  DARK_THEME,
  LIGHT_THEME,
  THEME_TOKENS,
  applyTheme,
  applyThemeToken,
  createCustomTheme,
  getTokenGroup,
  type ThemeDefinition,
  type ThemeToken,
  type CssStyleTheme,
} from '../settings/theme';
import { loadCssTheme } from '../settings/css-theme-loader';
import { ThemeEditorColorPanel } from './ThemeEditorColorPanel';
import { ThemeEditorCssPanel } from './ThemeEditorCssPanel';
import { DialogHeader, DialogOverlay, DialogSurface } from './ui/Dialog';

interface ThemeEditorProps {
  isOpen: boolean;
  onClose: () => void;
  themes: ThemeDefinition[];
  onThemesChange: (themes: ThemeDefinition[]) => void;
  activeThemeId: string;
  onActiveThemeChange: (id: string) => void;
  /** CSS样式主题 */
  cssThemes: CssStyleTheme[];
  onCssThemesChange: (themes: CssStyleTheme[]) => void;
  activeCssThemeId: string;
  onActiveCssThemeChange: (id: string) => void;
}

export function ThemeEditor({
  isOpen,
  onClose,
  themes,
  onThemesChange,
  activeThemeId,
  onActiveThemeChange,
  cssThemes,
  onCssThemesChange,
  activeCssThemeId,
  onActiveCssThemeChange,
}: ThemeEditorProps) {
  const lang = useAppStore((s) => s.lang);
  const [selectedThemeId, setSelectedThemeId] = useState(activeThemeId);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tab切换: 'color' | 'css'
  const [activeTab, setActiveTab] = useState<'color' | 'css'>('color');
  // CSS主题相关状态
  const [selectedCssThemeId, setSelectedCssThemeId] = useState(activeCssThemeId);
  const [cssUrlInput, setCssUrlInput] = useState('');
  const [cssNameInput, setCssNameInput] = useState('');

  // 打开时同步选中当前激活主题
  useEffect(() => {
    if (isOpen) setSelectedThemeId(activeThemeId);
  }, [isOpen, activeThemeId]);

  // 打开时同步CSS主题选中状态
  useEffect(() => {
    if (isOpen) setSelectedCssThemeId(activeCssThemeId);
  }, [isOpen, activeCssThemeId]);

  // CSS主题相关
  const allCssThemes = useMemo(
    () => [...BUILT_IN_CSS_THEMES, ...cssThemes],
    [cssThemes]
  );

  const selectedCssTheme = useMemo(
    () => allCssThemes.find((t) => t.id === selectedCssThemeId) ?? BUILT_IN_CSS_THEMES[0],
    [allCssThemes, selectedCssThemeId]
  );

  const isBuiltInCssTheme = selectedCssTheme?.isBuiltIn ?? true;

  const handleAddCssTheme = () => {
    const name = cssNameInput.trim() || 'Custom CSS Theme';
    const url = cssUrlInput.trim();
    if (!url) return;
    const newTheme: CssStyleTheme = {
      id: `custom-${Date.now()}`,
      name,
      url,
      isBuiltIn: false,
    };
    onCssThemesChange([...cssThemes, newTheme]);
    setSelectedCssThemeId(newTheme.id);
    onActiveCssThemeChange(newTheme.id);
    loadCssTheme(newTheme);
    setCssUrlInput('');
    setCssNameInput('');
  };

  const handleDeleteCssTheme = () => {
    if (isBuiltInCssTheme) return;
    const newThemes = cssThemes.filter((t) => t.id !== selectedCssThemeId);
    onCssThemesChange(newThemes);
    if (selectedCssThemeId === activeCssThemeId) {
      onActiveCssThemeChange(BUILT_IN_CSS_THEMES[0].id);
      loadCssTheme(BUILT_IN_CSS_THEMES[0]);
    }
    setSelectedCssThemeId(BUILT_IN_CSS_THEMES[0].id);
  };

  const handleActivateCssTheme = (theme: CssStyleTheme) => {
    onActiveCssThemeChange(theme.id);
    loadCssTheme(theme);
  };

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const allThemes = useMemo(
    () => [...BUILT_IN_THEMES, ...themes],
    [themes]
  );

  const selectedTheme = useMemo(
    () => allThemes.find((t) => t.id === selectedThemeId) ?? DARK_THEME,
    [allThemes, selectedThemeId]
  );

  const isBuiltIn = selectedTheme.isBuiltIn;

  const groupedTokens = useMemo(() => {
    const groups: Record<string, ThemeToken[]> = {};
    for (const token of THEME_TOKENS) {
      const g = getTokenGroup(token);
      (groups[g] ??= []).push(token);
    }
    return groups;
  }, []);

  const updateSelectedTheme = (patch: Partial<ThemeDefinition> | ((prev: ThemeDefinition) => ThemeDefinition)) => {
    if (isBuiltIn) return;
    const next = typeof patch === 'function' ? patch(selectedTheme) : { ...selectedTheme, ...patch };
    const newThemes = themes.map((t) => (t.id === next.id ? next : t));
    onThemesChange(newThemes);
    // 实时预览: 如果编辑的就是当前激活主题, 直接应用 token
    if (selectedThemeId === activeThemeId) {
      applyTheme(next);
    }
  };

  const handleTokenChange = (token: ThemeToken, value: string) => {
    updateSelectedTheme((prev) => ({
      ...prev,
      tokens: { ...prev.tokens, [token]: value },
    }));
    if (selectedThemeId === activeThemeId) {
      applyThemeToken(token, value);
    }
  };

  const handleAddTheme = () => {
    const base = allThemes.find((t) => t.id === selectedThemeId) ?? DARK_THEME;
    const newTheme = createCustomTheme(`${base.name} Copy`, base);
    onThemesChange([...themes, newTheme]);
    setSelectedThemeId(newTheme.id);
    onActiveThemeChange(newTheme.id);
    applyTheme(newTheme);
  };

  const handleDuplicate = () => {
    const newTheme = createCustomTheme(`${selectedTheme.name} Copy`, selectedTheme);
    onThemesChange([...themes, newTheme]);
    setSelectedThemeId(newTheme.id);
  };

  const handleDelete = () => {
    if (isBuiltIn) return;
    const newThemes = themes.filter((t) => t.id !== selectedTheme.id);
    onThemesChange(newThemes);
    // 若删除的是当前激活主题, 回退到 dark
    if (selectedTheme.id === activeThemeId) {
      onActiveThemeChange(DARK_THEME.id);
      applyTheme(DARK_THEME);
    }
    setSelectedThemeId(DARK_THEME.id);
  };

  const startRename = () => {
    if (isBuiltIn) return;
    setRenameValue(selectedTheme.name);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  };

  const commitRename = () => {
    const name = renameValue.trim();
    if (name && !isBuiltIn) {
      updateSelectedTheme({ name });
    }
    setRenaming(false);
  };

  const handleReset = () => {
    if (isBuiltIn) return;
    const base = selectedThemeId === LIGHT_THEME.id ? LIGHT_THEME : DARK_THEME;
    updateSelectedTheme({ tokens: { ...base.tokens } });
    if (selectedThemeId === activeThemeId) {
      applyTheme({ ...selectedTheme, tokens: { ...base.tokens } });
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(selectedTheme, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTheme.name.replace(/\s+/g, '_')}.theme.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (typeof reader.result !== 'string') return;
        const imported = JSON.parse(reader.result) as ThemeDefinition;
        if (!imported.tokens || !imported.name) return;
        const newTheme: ThemeDefinition = {
          ...imported,
          id: `custom-${Date.now()}`,
          isBuiltIn: false,
        };
        onThemesChange([...themes, newTheme]);
        setSelectedThemeId(newTheme.id);
        onActiveThemeChange(newTheme.id);
        applyTheme(newTheme);
      } catch {
        // ignore invalid import
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <DialogOverlay
      className="animate-[settings-fade-in_0.15s_ease-out]"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={activateOnKeyboard}
      role="button"
      tabIndex={0}
    >
      <DialogSurface
        className="w-[880px] max-w-[94vw] h-[640px] max-h-[90vh] animate-[settings-slide-in_0.2s_ease-out]"
        label={t(lang, 'themeEditor')}
      >
        {/* 顶部 */}
        <DialogHeader className="gap-3">
          <div className="flex items-center gap-1.5 text-text-primary text-base font-semibold flex-shrink-0">
            <Palette size={16} />
            <span>{t(lang, 'themeEditor')}</span>
          </div>
          {/* Tab切换 */}
          <div className="flex items-center gap-1 ml-4 px-1 py-0.5 bg-bg-input rounded-lg">
            <button
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                activeTab === 'color'
                  ? 'bg-bg-active text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
              onClick={() => setActiveTab('color')}
            >
              {t(lang, 'colorTheme')}
            </button>
            <button
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                activeTab === 'css'
                  ? 'bg-bg-active text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
              onClick={() => setActiveTab('css')}
            >
              {t(lang, 'cssTheme')}
            </button>
          </div>
          <div className="flex-1" />
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer bg-transparent border-none"
            onClick={onClose}
            title={t(lang, 'themeEditorClose')}
          >
            <X size={16} />
          </button>
        </DialogHeader>

        {/* 主体 */}
        <div className="flex-1 flex min-h-0">
          {activeTab === 'color' ? (
            <>
              {/* 左侧颜色主题列表 */}
              <div className="w-56 dialog-chrome-muted border-r border-border flex flex-col flex-shrink-0">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-[0.5px]">
                    {t(lang, 'themeList')}
                  </span>
                  <button
                    className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer bg-transparent border-none"
                    onClick={handleAddTheme}
                    title={t(lang, 'themeAdd')}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto py-1">
                  {allThemes.map((theme) => {
                    const active = theme.id === selectedThemeId;
                    return (
                      <div
                        key={theme.id}
                        className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-colors ${
                          active ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                        }`}
                        onClick={() => setSelectedThemeId(theme.id)}
                        onKeyDown={activateOnKeyboard}
                        role="button"
                        tabIndex={0}
                      >
                        <div
                          className="w-3 h-3 rounded-full border border-border flex-shrink-0"
                          style={{ background: theme.tokens.bgEditor }}
                        />
                        <span className="flex-1 truncate">{theme.name}</span>
                        {theme.id === activeThemeId && (
                          <Check size={12} className="text-accent flex-shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <ThemeEditorColorPanel
                selectedTheme={selectedTheme}
                selectedThemeId={selectedThemeId}
                activeThemeId={activeThemeId}
                isBuiltIn={isBuiltIn}
                renaming={renaming}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                setRenaming={setRenaming}
                renameInputRef={renameInputRef}
                commitRename={commitRename}
                startRename={startRename}
                handleDuplicate={handleDuplicate}
                handleDelete={handleDelete}
                handleImportClick={handleImportClick}
                fileInputRef={fileInputRef}
                handleImportFile={handleImportFile}
                handleExport={handleExport}
                handleReset={handleReset}
                groupedTokens={groupedTokens}
                handleTokenChange={handleTokenChange}
                onActiveThemeChange={onActiveThemeChange}
                onClose={onClose}
              />
            </>
          ) : (
            <>
              {/* 左侧CSS主题列表 */}
              <div className="w-56 dialog-chrome-muted border-r border-border flex flex-col flex-shrink-0">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-[0.5px]">
                    {t(lang, 'cssThemeList')}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto py-1">
                  {allCssThemes.map((theme) => {
                    const active = theme.id === selectedCssThemeId;
                    return (
                      <div
                        key={theme.id}
                        className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-colors ${
                          active ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                        }`}
                        onClick={() => setSelectedCssThemeId(theme.id)}
                        onKeyDown={activateOnKeyboard}
                        role="button"
                        tabIndex={0}
                      >
                        <FileCode size={14} className="flex-shrink-0" />
                        <span className="flex-1 truncate">{theme.name}</span>
                        {theme.id === activeCssThemeId && (
                          <Check size={12} className="text-accent flex-shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <ThemeEditorCssPanel
                selectedCssTheme={selectedCssTheme}
                selectedCssThemeId={selectedCssThemeId}
                activeCssThemeId={activeCssThemeId}
                isBuiltInCssTheme={isBuiltInCssTheme}
                cssNameInput={cssNameInput}
                setCssNameInput={setCssNameInput}
                cssUrlInput={cssUrlInput}
                setCssUrlInput={setCssUrlInput}
                handleAddCssTheme={handleAddCssTheme}
                handleDeleteCssTheme={handleDeleteCssTheme}
                handleActivateCssTheme={handleActivateCssTheme}
                onClose={onClose}
              />
            </>
          )}
        </div>
      </DialogSurface>
    </DialogOverlay>
  );
}

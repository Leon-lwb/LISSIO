import type { Dispatch, SetStateAction } from 'react';
import { Link, Trash } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { translate } from '../i18n';
import type { CssStyleTheme } from '../settings/theme';

interface ThemeEditorCssPanelProps {
  selectedCssTheme: CssStyleTheme | undefined;
  selectedCssThemeId: string;
  activeCssThemeId: string;
  isBuiltInCssTheme: boolean;
  cssNameInput: string;
  setCssNameInput: Dispatch<SetStateAction<string>>;
  cssUrlInput: string;
  setCssUrlInput: Dispatch<SetStateAction<string>>;
  handleAddCssTheme: () => void;
  handleDeleteCssTheme: () => void;
  handleActivateCssTheme: (theme: CssStyleTheme) => void;
  onClose: () => void;
}

export function ThemeEditorCssPanel({
  selectedCssTheme,
  selectedCssThemeId,
  activeCssThemeId,
  isBuiltInCssTheme,
  cssNameInput,
  setCssNameInput,
  cssUrlInput,
  setCssUrlInput,
  handleAddCssTheme,
  handleDeleteCssTheme,
  handleActivateCssTheme,
  onClose,
}: ThemeEditorCssPanelProps) {
  const lang = useAppStore((s) => s.lang);
  return (
                  <div className="flex-1 flex flex-col min-w-0 bg-bg-editor">
                    {/* 工具栏 */}
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0">
                      <span className="text-sm font-semibold text-text-primary">
                        {selectedCssTheme?.name}
                      </span>
                      <div className="flex-1" />
                      {!isBuiltInCssTheme && (
                        <button
                          className="px-2 py-1 text-xs text-text-secondary hover:bg-bg-danger-hover hover:text-text-inverse rounded inline-flex items-center gap-1 cursor-pointer bg-transparent border-none"
                          onClick={handleDeleteCssTheme}
                          title={translate('cssThemeDelete', lang)}
                        >
                          <Trash size={12} />
                          <span>{translate('cssThemeDelete', lang)}</span>
                        </button>
                      )}
                    </div>

                    {/* 只读提示 */}
                    {isBuiltInCssTheme && (
                      <div className="px-4 py-2 bg-bg-active text-text-primary text-xs flex-shrink-0">
                        {translate('cssThemeBuiltInReadOnly', lang)}
                      </div>
                    )}

                    {/* CSS主题信息 */}
                    <div className="flex-1 overflow-y-auto px-4 py-3">
                      <div className="mb-4">
                        <div className="section-heading pb-2 mb-2 border-b border-border">
                          {translate('cssThemeInfo', lang)}
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-start gap-2">
                            <span className="text-text-secondary min-w-[60px]">{translate('cssThemeName', lang)}:</span>
                            <span className="text-text-primary">{selectedCssTheme?.name}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-text-secondary min-w-[60px]">{translate('cssThemeUrl', lang)}:</span>
                            <span className="text-text-primary font-mono text-xs break-all">{selectedCssTheme?.url}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-text-secondary min-w-[60px]">{translate('cssThemeType', lang)}:</span>
                            <span className="text-text-primary">{selectedCssTheme?.isBuiltIn ? translate('cssThemeBuiltIn', lang) : translate('cssThemeCustom', lang)}</span>
                          </div>
                        </div>
                      </div>

                      {/* 添加自定义CSS主题 */}
                      {!isBuiltInCssTheme && (
                        <div className="mb-4">
                          <div className="section-heading pb-2 mb-2 border-b border-border">
                            {translate('cssThemeAddCustom', lang)}
                          </div>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs text-text-secondary mb-1">{translate('cssThemeName', lang)}</label>
                              <input
                                type="text"
                                value={cssNameInput}
                                onChange={(e) => setCssNameInput(e.target.value)}
                                placeholder="My Custom Theme"
                                className="w-full h-7 px-2 bg-bg-input text-text-primary border border-border rounded text-sm focus:outline-none focus:border-accent"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-text-secondary mb-1">{translate('cssThemeUrl', lang)}</label>
                              <input
                                type="text"
                                value={cssUrlInput}
                                onChange={(e) => setCssUrlInput(e.target.value)}
                                placeholder="https://example.com/theme.css"
                                className="w-full h-7 px-2 bg-bg-input text-text-primary border border-border rounded text-sm font-mono focus:outline-none focus:border-accent"
                              />
                            </div>
                            <button
                              className="px-3 py-1.5 bg-bg-button text-text-inverse border-none rounded text-sm cursor-pointer hover:bg-bg-button-hover inline-flex items-center gap-1"
                              onClick={handleAddCssTheme}
                              disabled={!cssUrlInput.trim()}
                            >
                              <Link size={12} />
                              {translate('cssThemeLoad', lang)}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* CSS主题使用说明 */}
                      <div>
                        <div className="section-heading pb-2 mb-2 border-b border-border">
                          {translate('cssThemeHelp', lang)}
                        </div>
                        <div className="text-xs text-text-secondary space-y-2">
                          <p>{translate('cssThemeHelpDesc1', lang)}</p>
                          <p>{translate('cssThemeHelpDesc2', lang)}</p>
                          <pre className="bg-bg-input p-2 rounded text-text-primary font-mono text-[11px] overflow-x-auto">
    {`:root {
      --color-accent: #ff6b6b;
      --color-bg-sidebar: #1a1a2e;
      --radius-default: 16px;
    }`}</pre>
                        </div>
                      </div>
                    </div>

                    {/* 底部操作 */}
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border dialog-chrome flex-shrink-0">
                      <div className="text-xs text-text-secondary">
                        {selectedCssThemeId === activeCssThemeId
                          ? translate('cssThemeActive', lang)
                          : translate('cssThemeClickToActivate', lang)}
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedCssThemeId !== activeCssThemeId && (
                          <button
                            className="px-3 py-1.5 bg-bg-button text-text-inverse border-none rounded text-sm cursor-pointer hover:bg-bg-button-hover"
                            onClick={() => selectedCssTheme && handleActivateCssTheme(selectedCssTheme)}
                          >
                            {translate('cssThemeActivate', lang)}
                          </button>
                        )}
                        <button
                          className="px-3 py-1.5 bg-transparent text-text-primary border border-border rounded text-sm cursor-pointer hover:bg-bg-hover"
                          onClick={onClose}
                        >
                          {translate('themeEditorClose', lang)}
                        </button>
                      </div>
                    </div>
                  </div>

  );
}

import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { Copy, Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { translate } from '../i18n';
import {
  TOKEN_LABELS,
  type ThemeDefinition,
  type ThemeToken,
} from '../settings/theme';
import type { TOKEN_GROUPS } from '../settings/theme';

export type GroupedThemeTokens = Partial<Record<
  (typeof TOKEN_GROUPS)[keyof typeof TOKEN_GROUPS],
  ThemeToken[]
>>;

const GROUP_LABELS: Record<(typeof TOKEN_GROUPS)[keyof typeof TOKEN_GROUPS], string> = {
  background: '背景',
  border: '边框',
  text: '文字',
  accent: '强调色',
};
const GROUP_ORDER: (keyof typeof GROUP_LABELS)[] = ['background', 'text', 'border', 'accent'];

/// 将颜色值转换为可用于 <input type="color"> 的 hex (无法解析则返回 null)
function toColorInputValue(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  // 简单解析 rgb/rgba
  const rgbMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(trimmed);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]).toString(16).padStart(2, '0');
    const g = Number(rgbMatch[2]).toString(16).padStart(2, '0');
    const b = Number(rgbMatch[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return null;
}

/// 颜色选择 + 文本输入组合控件
function ColorField({
  token,
  value,
  onChange,
  disabled,
}: {
  token: ThemeToken;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const colorValue = useMemo(() => toColorInputValue(value), [value]);

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div
        className="w-6 h-6 rounded border border-border flex-shrink-0"
        style={{ background: value }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-primary mb-0.5">{TOKEN_LABELS[token]}</div>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            value={colorValue ?? '#000000'}
            disabled={disabled ?? !colorValue}
            onChange={(e) => onChange(e.target.value)}
            className="w-7 h-7 p-0 border-0 rounded cursor-pointer bg-transparent disabled:opacity-disabled"
            title={token}
          />
          <input
            type="text"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 min-w-0 px-1.5 py-0.5 bg-bg-input text-text-primary border border-border rounded text-[11px] font-mono focus:outline-none focus:border-accent disabled:opacity-disabled"
          />
        </div>
      </div>
    </div>
  );
}

interface ThemeEditorColorPanelProps {
  selectedTheme: ThemeDefinition;
  selectedThemeId: string;
  activeThemeId: string;
  isBuiltIn: boolean;
  renaming: boolean;
  renameValue: string;
  setRenameValue: Dispatch<SetStateAction<string>>;
  setRenaming: Dispatch<SetStateAction<boolean>>;
  renameInputRef: RefObject<HTMLInputElement | null>;
  commitRename: () => void;
  startRename: () => void;
  handleDuplicate: () => void;
  handleDelete: () => void;
  handleImportClick: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleImportFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleExport: () => void;
  handleReset: () => void;
  groupedTokens: GroupedThemeTokens;
  handleTokenChange: (token: ThemeToken, value: string) => void;
  onActiveThemeChange: (id: string) => void;
  onClose: () => void;
}

export function ThemeEditorColorPanel({
  selectedTheme,
  selectedThemeId,
  activeThemeId,
  isBuiltIn,
  renaming,
  renameValue,
  setRenameValue,
  setRenaming,
  renameInputRef,
  commitRename,
  startRename,
  handleDuplicate,
  handleDelete,
  handleImportClick,
  fileInputRef,
  handleImportFile,
  handleExport,
  handleReset,
  groupedTokens,
  handleTokenChange,
  onActiveThemeChange,
  onClose,
}: ThemeEditorColorPanelProps) {
  const lang = useAppStore((s) => s.lang);
  return (
                  <div className="flex-1 flex flex-col min-w-0 bg-bg-editor">
                    {/* 工具栏 */}
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0">
                      {renaming && !isBuiltIn ? (
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setRenaming(false);
                          }}
                          className="px-2 py-1 bg-bg-input text-text-primary border border-border rounded text-sm font-semibold focus:outline-none focus:border-accent"
                        />
                      ) : (
                        <button
                          className="text-sm font-semibold text-text-primary hover:bg-bg-hover px-2 py-1 rounded cursor-pointer bg-transparent border-none"
                          onClick={startRename}
                          disabled={isBuiltIn}
                          title={isBuiltIn ? undefined : translate('themeRename', lang)}
                        >
                          {selectedTheme.name}
                        </button>
                      )}
                      <div className="flex-1" />
                      {!isBuiltIn && (
                        <>
                          <button
                            className="px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary rounded inline-flex items-center gap-1 cursor-pointer bg-transparent border-none"
                            onClick={handleDuplicate}
                            title={translate('themeDuplicate', lang)}
                          >
                            <Copy size={12} />
                            <span>{translate('themeDuplicate', lang)}</span>
                          </button>
                          <button
                            className="px-2 py-1 text-xs text-text-secondary hover:bg-bg-danger-hover hover:text-text-inverse rounded inline-flex items-center gap-1 cursor-pointer bg-transparent border-none"
                            onClick={handleDelete}
                            title={translate('themeDelete', lang)}
                          >
                            <Trash2 size={12} />
                            <span>{translate('themeDelete', lang)}</span>
                          </button>
                        </>
                      )}
                      <div className="w-px h-4 bg-border mx-1" />
                      <button
                        className="px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary rounded inline-flex items-center gap-1 cursor-pointer bg-transparent border-none"
                        onClick={handleImportClick}
                        title={translate('themeImport', lang)}
                      >
                        <Upload size={12} />
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={handleImportFile}
                      />
                      <button
                        className="px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary rounded inline-flex items-center gap-1 cursor-pointer bg-transparent border-none"
                        onClick={handleExport}
                        title={translate('themeExport', lang)}
                      >
                        <Download size={12} />
                      </button>
                      {!isBuiltIn && (
                        <button
                          className="px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary rounded inline-flex items-center gap-1 cursor-pointer bg-transparent border-none"
                          onClick={handleReset}
                          title={translate('themeReset', lang)}
                        >
                          <RotateCcw size={12} />
                          <span>{translate('themeReset', lang)}</span>
                        </button>
                      )}
                    </div>

                    {/* 只读提示 */}
                    {isBuiltIn && (
                      <div className="px-4 py-2 bg-bg-active text-text-primary text-xs flex-shrink-0">
                        {translate('themeBuiltInReadOnly', lang)}
                      </div>
                    )}

                    {/* Token 网格 */}
                    <div className="flex-1 overflow-y-auto px-4 py-3">
                      {GROUP_ORDER.map((group) => {
                        const tokens = groupedTokens[group];
                        if (!tokens?.length) return null;
                        return (
                          <div key={group} className="mb-5">
                            <div className="section-heading pb-2 mb-2 border-b border-border">
                              {GROUP_LABELS[group]}
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              {tokens.map((token) => (
                                <ColorField
                                  key={token}
                                  token={token}
                                  value={selectedTheme.tokens[token]}
                                  onChange={(v) => handleTokenChange(token, v)}
                                  disabled={isBuiltIn}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 底部操作 */}
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border dialog-chrome flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded border border-border"
                          style={{
                            background: `linear-gradient(135deg, ${selectedTheme.tokens.bgEditor} 50%, ${selectedTheme.tokens.bgSidebar} 50%)`,
                          }}
                        />
                        <div className="text-xs text-text-secondary">
                          {selectedThemeId === activeThemeId
                            ? translate('themeActivePreview', lang)
                            : translate('themeClickToPreview', lang)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedThemeId !== activeThemeId && !isBuiltIn && (
                          <button
                            className="px-3 py-1.5 bg-bg-button text-text-inverse border-none rounded text-sm cursor-pointer hover:bg-bg-button-hover"
                            onClick={() => onActiveThemeChange(selectedTheme.id)}
                          >
                            {translate('themeActivate', lang)}
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

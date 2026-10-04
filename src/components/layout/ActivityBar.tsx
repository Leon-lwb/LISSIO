import { memo } from 'react';
import {
  Cable,
  Database,
  Layers,
  Settings,
  Info,
  HelpCircle,
  PanelLeft,
  Rocket,
  Network,
} from 'lucide-react';
import clsx from 'clsx';
import type { SidebarView } from '../../store/appStore';
import { useAppStore } from '../../store/appStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useContextMenu } from '../../lib/hooks/useContextMenu';
import { transitionStore } from '../../lib/utils/transitionStore';
import { activateOnKeyboard } from '../../lib/utils/a11y';
import { translate, type TranslationKey } from '../../i18n';
import { CATEGORY_ICONS, PALETTE_CATEGORY_IDS, categoryLabel } from '../panels/widgetPalette/paletteSections';

interface ActivityBarProps {
  activeView: SidebarView | null;
  onSelect: (view: SidebarView) => void;
}

/// 左侧活动栏 — VSCode 风格图标导航
/// 分类入口定位连续目录，按连接、处理、展示、扩展排列。
export const ActivityBar = memo(function ActivityBar({ activeView, onSelect }: ActivityBarProps) {
  const lang = useAppStore((s) => s.lang);
  const sidebarView = useAppStore((s) => s.sidebarView);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const activeCategory = useAppStore((s) => s.activeCategory);
  const selectCategory = useAppStore((s) => s.selectCategory);
  const refreshPorts = useAppStore((s) => s.refreshPorts);
  const openSettings = useSettingsStore((s) => s.open);
  const openAbout = useSettingsStore((s) => s.openAbout);
  const openHelp = useOnboardingStore((s) => s.openHelp);

  const onContextMenu = useContextMenu([
    {
      id: 'toggle-sidebar',
      label: sidebarVisible ? translate('contextMenuHideSidebar', lang) : translate('contextMenuShowSidebar', lang),
      icon: <PanelLeft />,
      onClick: () => transitionStore(() => toggleSidebar(sidebarView)),
    },
    { kind: 'separator' },
    {
      id: 'refresh-ports',
      label: translate('refresh', lang),
      icon: <Cable />,
      onClick: () => { void refreshPorts(); },
    },
    {
      id: 'settings',
      label: translate('settings', lang),
      icon: <Settings />,
      onClick: openSettings,
    },
    {
      id: 'about',
      label: translate('about', lang),
      icon: <Info />,
      onClick: openAbout,
    },
    {
      id: 'help',
      label: translate('helpCenterOpen', lang),
      icon: <HelpCircle />,
      onClick: openHelp,
    },
  ]);

  const items: { view: SidebarView; icon: React.ReactNode; key: TranslationKey }[] = [
    { view: 'devices', icon: <Network size={22} />, key: 'deviceTreeTitle' },
    { view: 'quickstart', icon: <Rocket size={22} />, key: 'quickStart' },
    { view: 'panels', icon: <Layers size={22} />, key: 'menuPanel' },
    { view: 'recording', icon: <Database size={22} />, key: 'recordingDatabaseTitle' },
  ];

  return (
    // 根节点用 w-full 而非 w-12: 外层 module-card 有 1px 边框, 内容盒仅 46px;
    // 若这里固定 48px 会向两侧溢出 1px, 导致激活高亮块相对外围框左右间隙不等距 (5px / 3px)。
    // w-full 使按钮在可见区域内居中, 两侧均为 4px。
    <div className="w-full h-full overflow-x-hidden bg-bg-activity flex flex-col items-center py-1 gap-1 flex-shrink-0" onContextMenu={onContextMenu}>
      {items.map((item) => (
        <div
          key={item.view}
          data-tour={item.view}
          className={clsx(
            "w-10 h-10 shrink-0 mx-1 rounded-md flex items-center justify-center cursor-pointer transition-colors active:bg-accent-active",
            activeView === item.view
              ? "text-text-bright bg-bg-active"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
          )}
          title={translate(item.key, lang)}
          onClick={() => transitionStore(() => onSelect(item.view))}
          onKeyDown={activateOnKeyboard}
          role="button"
          tabIndex={0}
        >
          {item.icon}
        </div>
      ))}
      <div className="flex flex-col items-center gap-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden w-full" data-tour="palette-jumpbar">
        {PALETTE_CATEGORY_IDS.map((id) => {
          const Icon = CATEGORY_ICONS[id];
          const active = activeView === 'category' && activeCategory === id;
          return (
            <div
              key={id}
              data-tour={`category-${id}`}
              className={clsx(
                "w-10 max-w-full h-10 shrink-0 rounded-md flex items-center justify-center cursor-pointer transition-colors active:bg-accent-active flex-shrink-0",
                active
                  ? "text-text-bright bg-bg-active"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              )}
              aria-label={categoryLabel(lang, id)}
              aria-current={active ? 'location' : undefined}
              style={['math', 'display', 'attributes'].includes(id) ? { marginTop: 6, borderTop: '1px solid var(--color-border-subtle)' } : undefined}
              title={categoryLabel(lang, id)}
              onClick={() => transitionStore(() => selectCategory(id))}
              onKeyDown={activateOnKeyboard}
              role="button"
              tabIndex={0}
            >
              <Icon size={22} />
            </div>
          );
        })}
      </div>
      <div className="flex-1" />
      <div
        data-tour="help"
        className="w-10 h-10 shrink-0 mx-1 rounded-md flex items-center justify-center cursor-pointer text-text-secondary hover:text-text-primary hover:bg-bg-hover active:bg-accent-active transition-colors"
        title={translate('helpCenterOpen', lang)}
        onClick={openHelp}
        onKeyDown={activateOnKeyboard}
        role="button"
        tabIndex={0}
      >
        <HelpCircle size={22} />
      </div>
      <div
        className="w-10 h-10 shrink-0 mx-1 rounded-md flex items-center justify-center cursor-pointer text-text-secondary hover:text-text-primary hover:bg-bg-hover active:bg-accent-active transition-colors"
        title={translate('about', lang)}
        onClick={openAbout}
        onKeyDown={activateOnKeyboard}
        role="button"
        tabIndex={0}
      >
        <Info size={22} />
      </div>
      <div
        className="w-10 h-10 shrink-0 mx-1 rounded-md flex items-center justify-center cursor-pointer text-text-secondary hover:text-text-primary hover:bg-bg-hover active:bg-accent-active transition-colors"
        title={translate('settings', lang)}
        onClick={() => openSettings()}
        onKeyDown={activateOnKeyboard}
        role="button"
        tabIndex={0}
      >
        <Settings size={22} />
      </div>
    </div>
  );
});

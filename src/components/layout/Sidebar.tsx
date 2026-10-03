import { memo } from 'react';
import { useAppStore } from '../../store/appStore';
import type { SidebarView } from '../../store/appStore';
import { useContextMenu } from '../../lib/hooks/useContextMenu';
import { transitionStore } from '../../lib/utils/transitionStore';
import { dockDrag } from '../../lib/dockDrag';
import { translate, type TranslationKey } from '../../i18n';
import { CategoryPanel } from '../panels/widgetPalette';
import { QuickStartPanel } from '../panels/QuickStartPanel';
import { DataPanelsPanel } from '../panels/DataPanelsPanel';
import { RecordingDatabasePanel } from '../panels/RecordingDatabasePanel';
import { PanelLeft, RefreshCw } from 'lucide-react';
import { AnimatedSwitch } from '../ui/AnimatedSwitch';
import { useLayoutStore } from '../../store/layoutStore';
import { categoryLabel } from '../panels/widgetPalette/paletteSections';
import { DeviceTreePanel } from '../acquisition/DeviceTreePanel';

interface SidebarProps {
  view: SidebarView;
}

/// 侧边栏容器 — 根据当前视图切换面板
export const Sidebar = memo(function Sidebar({ view }: SidebarProps) {
  const lang = useAppStore((s) => s.lang);
  const sidebarView = useAppStore((s) => s.sidebarView);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const refreshPorts = useAppStore((s) => s.refreshPorts);

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
      icon: <RefreshCw />,
      onClick: () => { void refreshPorts(); },
    },
  ]);

  const titleMap: Partial<Record<SidebarView, TranslationKey>> = {
    devices: 'deviceTreeTitle',
    quickstart: 'quickStart',
    panels: 'menuPanel',
    recording: 'recordingDatabaseTitle',
  };

  const activeCategory = useAppStore((s) => s.activeCategory);
  const title = view === 'category' ? categoryLabel(lang, activeCategory) : translate(titleMap[view] ?? 'quickStart', lang);

  // 标题栏为拖拽源 — 拖到窗口左/右边缘可切换停靠侧 (dockDrag 控制器)
  const draggingSidebar = useLayoutStore((s) => s.draggingSidebar);

  return (
    <div
      className={`bg-bg-sidebar flex flex-col h-full w-full min-w-[200px] overflow-hidden ${
        draggingSidebar ? 'ring-2 ring-inset ring-accent' : ''
      }`}
      onContextMenu={onContextMenu}
    >
      <div
        className={`px-4 text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center flex-shrink-0 cursor-grab active:cursor-grabbing select-none ${view === 'category' ? 'h-3 justify-center' : 'h-9 justify-between border-b border-border-subtle'}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest('button, input')) return;
          dockDrag.begin(e, { kind: 'sidebar', label: title });
        }}
        title={translate('dragToDock', lang)}
      >
        <span className={view === 'category' ? 'h-1 w-8 rounded-full bg-border' : undefined}>{view !== 'category' && title}</span>
      </div>
      {/* 内容区 — 不自己滚动, 约束高度让各面板 (QuickStart/CategoryPanel/DataPanels) 内部滚动 */}
      <div className="flex-1 min-h-0 overflow-hidden px-3 py-3">
        <AnimatedSwitch
          switchKey={view}
          order={['devices', 'quickstart', 'category', 'panels', 'recording']}
          axis="y"
          className="h-full"
        >
          {view === 'quickstart' && <QuickStartPanel />}
          {view === 'devices' && <DeviceTreePanel />}
          {view === 'category' && <CategoryPanel />}
          {view === 'panels' && <DataPanelsPanel />}
          {view === 'recording' && <RecordingDatabasePanel />}
        </AnimatedSwitch>
      </div>
    </div>
  );
});

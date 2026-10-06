// ============ 数据 Tab 内容宿主 ============
//
// 唯一的 tab → 内容分派点:
//   数据面板 (12) → 面板注册表 (panelDefs / panelViews) 的视图面
//   应用外壳 (5)  → SHELL_TAB_CONTENT 的常量元素
//
// 分派所需的一切 (tab 类型 / 宿主控件 / 图标) 都来自注册表, 本模块不再维护任何
// kind → 视图 / tab 类型的平行表。宿主控件按 `tab.widgetId` + 面板声明的
// `hostWidgetKind` 解析后下发; 具体收窄与缺失占位由各视图自理。
//
// 本模块只保留与「本 tab 视图无关」的 store 级卫生: 画布控件被删除时回收其在
// waveformScopeStore 的示波配置。

import { memo, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { selectWidgets } from '../../store/appStoreHelpers';
import { useWaveformScopeStore } from '../../store/waveformScopeStore';
import { isShellTabType, panelDefForTabType } from '../../lib/panels/panelDefs';
import { PANEL_VIEWS, SHELL_TAB_CONTENT } from '../panels/registry/panelViews';
import { FrozenPanelOutline, LiveStatusBadge, PanelLivenessProvider } from '../displays/common/PanelLiveness';
import type { WidgetConfig } from '../../types';

/// 单个数据 Tab 的内容渲染器 — 由 DockCardFrame 挂载, 可被多个卡片各自实例化。
export const DataTabContent = memo(function DataTabContent({ tabId }: { tabId: string }) {
  const dataTabs = useAppStore((s) => s.dataTabs);
  const widgets = useAppStore((s) => selectWidgets(s));
  const pruneWidgets = useWaveformScopeStore((s) => s.pruneWidgets);

  // 移除 widget 时清理其示波配置 — 整库卫生, 与当前 tab 是哪个面板无关
  useEffect(() => {
    pruneWidgets(widgets.map((w) => w.params.id));
  }, [widgets, pruneWidgets]);

  const tab = dataTabs.find((t) => t.id === tabId);
  if (!tab) return null;

  const def = panelDefForTabType(tab.type);
  if (def) {
    const hostKind = def.hostWidgetKind;
    const widget: WidgetConfig | undefined =
      hostKind === null
        ? undefined
        : widgets.find((w) => w.params.id === tab.widgetId && w.kind === hostKind);
    const View = PANEL_VIEWS[def.panelKind];
    // 时效派生层统一挂载点: 面板只上报"是否跟随最新"与"跳最新"处理,
    // 非实时角标与内容区描边由宿主渲染, 面板自身不重复实现时效 UI。
    return (
      <PanelLivenessProvider panelKey={tab.id}>
        <div className="relative h-full w-full">
          <View tab={tab} widget={widget} widgets={widgets} />
          <FrozenPanelOutline panelKey={tab.id} />
          <LiveStatusBadge panelKey={tab.id} />
        </div>
      </PanelLivenessProvider>
    );
  }

  if (isShellTabType(tab.type)) return SHELL_TAB_CONTENT[tab.type];
  return null;
});

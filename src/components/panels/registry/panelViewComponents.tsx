// ============ 数据面板注册表 — 视图组件实现 ============
//
// `panelViews.tsx` 的表体 (12 个面板的停靠区内容组件 + 2 个整库面板的模块级常量
// 元素) 集中在本模块。
//
// 为什么与 `panelViews.tsx` 分文件: `react-refresh/only-export-components` 的
// `localComponents` 分支要求「同时导出组件与映射常量」的文件必须拆开 —— 该分支
// 由本地组件声明触发, `allowExportNames` / `allowConstantExport` 都在组件登记
// 之前提前 return, 因此**任何选项组合都无法抑制**(已实测确认)。拆分同时带来
// 实际收益: 本模块只导出组件, 编辑单个视图可正常走 Fast Refresh 热更新;
// `panelViews.tsx` 只导出常量, 与 `panelDefs.ts` 一样是纯映射表。
//
// 视图是「纯内容」: 外壳 chrome (tab 条 / 停靠卡片) 由 DockCardFrame 提供, 与
// WIDGET_REGISTRY 的控件组件同一约定。全部 memo 化, 且只依赖稳定 props, 使
// DataTabContent 自身的重渲染 (lang / widgets 等订阅变化) 不级联进重型子视图。
//
// 波形视图不在本模块: 它自带停靠级缓冲编排, 见 displays/waveform/WaveformTabView。

import { Suspense, lazy, memo } from 'react';
import { useAppStore } from '../../../store/appStore';
import { translate } from '../../../i18n';
import { RawDataView } from '../../displays/rawdata/RawDataView';
import { PieChart } from '../../widgets/pieChart/PieChartWidget';
import { ImageViewer } from '../../widgets/image/ImageWidget';
import { SpectrumChart } from '../../displays/widgets/SpectrumChart';
import { CommandSender } from '../../displays/command/CommandSender';
import { CanView } from '../../displays/can/CanView';
import { LogicView } from '../../displays/logic/LogicView';
import { FrameDecoder } from '../../displays/decoder/FrameDecoder';
import { Trigger } from '../../widgets/trigger/TriggerView';
import { TableView } from '../../displays/widgets/TableView';
import { SuspenseFallback } from '../../ui/SuspenseFallback';
import type { WidgetConfig } from '../../../types';
import type { PanelTabViewProps } from './panelTypes';

// 重型 3D 控件 (Three.js) — 懒加载, 首次切到 model3d Tab 时才拉取
// (清单见 components/lazy/lazyComponents.ts — 全仓唯一 React.lazy 声明点)
const Model3DWidget = lazy(() => import('../../widgets/model3d/Model3DWidget'));

/// 宿主控件已被删除 (或 tab 的 widgetId 失效) 的占位 — 不静默空白。
export const PanelHostMissing = memo(function PanelHostMissing() {
  const lang = useAppStore((s) => s.lang);
  return (
    <div className="flex items-center justify-center h-full text-text-secondary text-sm">
      {translate('noWidgets', lang)}
    </div>
  );
});

// =====================================================================
// 派生面板 (有宿主控件)
// =====================================================================

/// 原始数据面板直接按 tab 的 widgetId 找源 (端口由 widget 参数持有), 不要求
/// 宿主控件实例存在 —— 与其他派生面板不同, 保持既有行为。
export const RawPanelView = memo(function RawPanelView({ tab }: PanelTabViewProps) {
  return <RawDataView widgetId={tab.widgetId} />;
});

export const PiePanelView = memo(function PiePanelView({ widget }: PanelTabViewProps) {
  const host = widget?.kind === 'PieChart' ? widget : undefined;
  if (!host) return <PanelHostMissing />;
  return (
    <div className="flex h-full p-2">
      <PieChart widget={host} full />
    </div>
  );
});

export const ImagePanelView = memo(function ImagePanelView({ widget }: PanelTabViewProps) {
  const host = widget?.kind === 'Image' ? widget : undefined;
  if (!host) return <PanelHostMissing />;
  return (
    <div className="flex h-full p-2">
      <ImageViewer widget={host} full />
    </div>
  );
});

export const Model3DPanelView = memo(function Model3DPanelView({ widget }: PanelTabViewProps) {
  const host = widget?.kind === 'Model3D' ? widget : undefined;
  if (!host) return <PanelHostMissing />;
  return (
    <div className="flex h-full">
      <Suspense fallback={<SuspenseFallback />}>
        <Model3DWidget widget={host} />
      </Suspense>
    </div>
  );
});

export const SpectrumPanelView = memo(function SpectrumPanelView({ widget }: PanelTabViewProps) {
  const host = widget?.kind === 'Spectrum' ? widget : undefined;
  if (!host) return <PanelHostMissing />;
  return (
    <div className="flex h-full">
      <SpectrumChart widget={host} />
    </div>
  );
});

export const CommandPanelView = memo(function CommandPanelView({ widget }: PanelTabViewProps) {
  const host = widget?.kind === 'Command' ? widget : undefined;
  if (!host) return <PanelHostMissing />;
  return (
    <div className="flex h-full p-2">
      <CommandSender widget={host} />
    </div>
  );
});

/// 表格面板额外读同画布上首个开启回环的 Command 控件的历史 — 跨面板查询。
function loopbackCommandWidget(
  widgets: readonly WidgetConfig[]
): Extract<WidgetConfig, { kind: 'Command' }> | undefined {
  for (const widget of widgets) {
    if (widget.kind === 'Command' && widget.params.loopbackEnabled) return widget;
  }
  return undefined;
}

export const TablePanelView = memo(function TablePanelView({ widget, widgets }: PanelTabViewProps) {
  const host = widget?.kind === 'TableView' ? widget : undefined;
  if (!host) return <PanelHostMissing />;
  const command = loopbackCommandWidget(widgets);
  return (
    <div className="flex h-full w-full">
      <TableView widget={host} loopbackHistory={command?.params.loopbackHistory} />
    </div>
  );
});

export const FrameDecoderPanelView = memo(function FrameDecoderPanelView({
  widget,
}: PanelTabViewProps) {
  const host = widget?.kind === 'FrameDecoder' ? widget : undefined;
  if (!host) return <PanelHostMissing />;
  return (
    <div className="flex h-full w-full">
      <FrameDecoder widget={host} />
    </div>
  );
});

export const TriggerPanelView = memo(function TriggerPanelView({ widget }: PanelTabViewProps) {
  const host = widget?.kind === 'Trigger' ? widget : undefined;
  if (!host) return <PanelHostMissing />;
  return (
    <div className="flex h-full w-full">
      <Trigger widget={host} />
    </div>
  );
});

// =====================================================================
// 整库面板 (无宿主控件) — 无 props 分支, 返回模块级常量元素使得 React 在
// beginWork 中因元素引用相等直接 bailout, 完全跳过子树重渲染
// =====================================================================

const canTabContent = (
  <div className="flex h-full w-full">
    <CanView />
  </div>
);
const logicTabContent = (
  <div className="flex h-full w-full">
    <LogicView />
  </div>
);

export const CanPanelView = memo(function CanPanelView() {
  return canTabContent;
});

export const LogicPanelView = memo(function LogicPanelView() {
  return logicTabContent;
});

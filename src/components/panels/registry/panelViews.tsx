// ============ 数据面板注册表 — 视图面 (映射表) ============
//
// 面板身份 → 停靠区内容组件, 以及外壳 tab → 内容元素。本模块只含常量映射, 与
// 元数据面 (panelDefs.ts) 一样是纯表; 视图组件实现位于 panelViewComponents.tsx
// (拆分的动因见该文件头部)。
//
// 与 `PANEL_DEFS` 共用同一 `PanelKind` / `ShellTabType` 键空间, 两张表都是
// `Record<…>` 编译期穷举 —— 新增面板漏写视图会直接编译失败, 不会静默空白。

import type { ReactNode } from 'react';
import { WaveformTabView } from '../../displays/waveform/WaveformTabView';
import { CompileErrorsView } from '../../displays/compileErrors/CompileErrorsView';
import { CompileResultsView } from '../../displays/compileResults/CompileResultsView';
import { OperationHistoryView } from '../../displays/history/OperationHistoryView';
import { RecordingDatabaseView } from '../../displays/recording/RecordingDatabaseView';
import { NodePropertiesPanel } from '../../nodes/NodePropertiesPanel';
import {
  CanPanelView,
  CommandPanelView,
  FrameDecoderPanelView,
  ImagePanelView,
  LogicPanelView,
  Model3DPanelView,
  PiePanelView,
  RawPanelView,
  SpectrumPanelView,
  TablePanelView,
  TriggerPanelView,
} from './panelViewComponents';
import type { PanelKind } from '../../../types/generated/PanelKind';
import type { PanelTabView, ShellTabType } from './panelTypes';

/// 面板身份 → 停靠区视图 —— 与 `PANEL_DEFS` 同一键空间, 编译期穷举。
export const PANEL_VIEWS: Readonly<Record<PanelKind, PanelTabView>> = {
  waveform: WaveformTabView,
  spectrum: SpectrumPanelView,
  raw: RawPanelView,
  pie: PiePanelView,
  image: ImagePanelView,
  model3d: Model3DPanelView,
  'table-view': TablePanelView,
  command: CommandPanelView,
  'frame-decoder': FrameDecoderPanelView,
  trigger: TriggerPanelView,
  can: CanPanelView,
  logic: LogicPanelView,
};

// =====================================================================
// 纯应用外壳 — 不是数据面板, 没有后端契约
// =====================================================================

const compileErrorsTabContent = (
  <div className="flex h-full w-full">
    <CompileErrorsView />
  </div>
);
const compileResultsTabContent = (
  <div className="flex h-full w-full">
    <CompileResultsView />
  </div>
);
const operationHistoryTabContent = (
  <div className="flex h-full w-full">
    <OperationHistoryView />
  </div>
);
const nodePropertiesTabContent = (
  <div className="flex h-full w-full">
    <NodePropertiesPanel />
  </div>
);
const recordingDatabaseTabContent = (
  <div className="flex h-full w-full">
    <RecordingDatabaseView />
  </div>
);

/// 外壳 tab 类型 → 内容元素。
export const SHELL_TAB_CONTENT: Readonly<Record<ShellTabType, ReactNode>> = {
  'compile-errors': compileErrorsTabContent,
  'compile-results': compileResultsTabContent,
  'operation-history': operationHistoryTabContent,
  'node-properties': nodePropertiesTabContent,
  'recording-database': recordingDatabaseTabContent,
};

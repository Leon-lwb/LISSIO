import { create } from 'zustand';
import { setWorkspaceRunState } from './displayLiveness';
import { createSidebarSlice, type SidebarSlice } from './slices/sidebar';
import { createConnectionSlice, type ConnectionSlice } from './slices/connection';
import { createProtocolSlice, type ProtocolSlice } from './slices/protocol';
import { createWidgetSlice, type WidgetSlice } from './slices/widgets';
import { createControlTabSlice, type ControlTabSlice } from './slices/controlTabs';
import { createGraphSlice, type GraphSlice } from './slices/graph';
import { createDataTabSlice, type DataTabSlice } from './slices/dataTabs';
import { createDataSlice, type DataSlice } from './slices/data';
import { createGraphStateSlice } from './slices/graphState';
import { createEventSlice, type EventSlice } from './slices/events';
import { createDerivedSlice, type DerivedSlice } from './slices/derived';
import { createCompileStatusSlice, type CompileStatusSlice } from './slices/compileStatus';
import { createCompileHirSlice, type CompileHirSlice } from './slices/compileHir';
import { createRunControlSlice, type RunControlSlice } from './slices/runControl';

export type { SidebarView } from './slices/sidebar';
export {
  isStructuralNode,
  syncTabGraphToBackend,
  traceProtocolSource,
  downstreamProtocolOf,
} from './appStoreHelpers';

export type AppStore = SidebarSlice
  & ConnectionSlice
  & ProtocolSlice
  & WidgetSlice
  & ControlTabSlice
  & GraphSlice
  & DataTabSlice
  & DataSlice
  & ReturnType<typeof createGraphStateSlice>
  & EventSlice
  & DerivedSlice
  & CompileStatusSlice
  & CompileHirSlice
  & RunControlSlice;

export const useAppStore = create<AppStore>()((set, get) => ({
  ...createSidebarSlice(set, get),
  ...createConnectionSlice(set, get),
  ...createProtocolSlice(set, get),
  ...createWidgetSlice(set, get),
  ...createControlTabSlice(set, get),
  ...createGraphSlice(set, get),
  ...createDataTabSlice(set, get),
  ...createDataSlice(set, get),
  ...createGraphStateSlice(),
  ...createEventSlice(set, get),
  ...createDerivedSlice(set, get),
  ...createCompileStatusSlice(set, get),
  ...createCompileHirSlice(set, get),
  ...createRunControlSlice(set, get),
}));

// 显示时效派生层接线 — 运行态是唯一输入: 派生层据此冻结实时推送 (暂停),
// 并在"从暂停恢复"时统一广播"跳最新"。挂在 store 订阅而不是逐写入点调用:
// 命令返回、`workspace:run` 事件与其他写入方都收敛到 runState, 一处接线即可覆盖。
useAppStore.subscribe((state, previous) => {
  if (state.runState !== previous.runState) {
    setWorkspaceRunState(state.runState);
  }
});

import { nanoid } from 'nanoid';
import { withHistoryOp } from '../../store/historyStore';
import type { WidgetDragSpec } from '../dockDrag';
import { useAppStore } from '../../store/appStore';
import { addAcquisitionNode } from '../acquisition/acquisitionNodes';

/** 点击与画布投放共用结构节点创建入口。 */
export function addPaletteNode(spec: WidgetDragSpec, position: { x: number; y: number }, tabId = useAppStore.getState().activeControlTabId): boolean {
  const app = useAppStore.getState();
  switch (spec.nodeType) {
    case 'point-selector':
      addPointSelectorNode(position, tabId);
      return true;
    case 'protocol':
      app.addProtocolNode(undefined, position, tabId);
      return true;
    case 'acquisition':
      if (spec.acquisition) addAcquisitionNode(spec.acquisition, position, tabId);
      return true;
    default:
      return false;
  }
}

export function addPointSelectorNode(
  position: { x: number; y: number },
  tabId = useAppStore.getState().activeControlTabId,
): string {
  const id = `points-${nanoid(8)}`;
  withHistoryOp({ opKey: 'opAddProtocolNode' }, () => {
    useAppStore.setState(s => ({ rfNodes: [...s.rfNodes, { id, type: 'point-selector', position,
      width: 200, data: { tabId, label: '点位选择', points: [] } }] }));
    useAppStore.getState().syncAllTabGraphs();
  });
  return id;
}

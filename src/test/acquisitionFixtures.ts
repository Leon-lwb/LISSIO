//! 设备画布节点夹具 — 测试用 decl → 画布节点视图映射 (与生产 canvasNode
//! 的 device 分支同形, 供设备树/仿真测试构造夹具)。

import type { Node } from '@xyflow/react';
import type { DeviceTreeNodeDecl } from '../types';
import type { AcquisitionNodeData } from '../lib/acquisition/acquisitionNodes';
import { useAppStore } from '../store/appStore';

export function acquisitionNodeFromDecl(
  node: DeviceTreeNodeDecl,
  position = { x: 60, y: 60 },
  _card?: unknown,
  tabId = useAppStore.getState().activeControlTabId,
): Node<AcquisitionNodeData> {
  return {
    id: node.id,
    type: 'acquisition',
    position,
    width: 200,
    data: {
      tabId,
      label: node.name,
      node,
    },
  };
}

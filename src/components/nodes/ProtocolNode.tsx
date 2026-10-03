import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useAppStore } from '../../store/appStore';
import { translate } from '../../i18n';
import type { ProtocolNodeData } from '../../store/appStoreHelpers';
import { useDescribeEntry, describeDomainToUi } from '../../lib/models/describeStore';
import { NodeFrame } from './NodeFrame';
import { removeDeviceTreeChild, updateDeviceTreeChild } from '../../lib/acquisition/deviceTree';

export const ProtocolNode = memo(function ProtocolNode({ id, data, selected }: NodeProps) {
  const lang = useAppStore((s) => s.lang);
  const remove = useAppStore((s) => s.removeNode);
  const rename = useAppStore((s) => s.renameNode);
  const derived = useAppStore((s) => s.derivedPorts[id]);
  const description = useDescribeEntry(id).description;
  const config = data as ProtocolNodeData;
  const treeRootId = typeof data.treeRootId === 'string' ? data.treeRootId : null;
  // 端口显示: 运行时派生 (graph:derived) 优先, 静态模型视图来自 describe
  const ports = derived?.ports.map((port) => port.name)
    ?? (description?.outputs ?? []).map((port) => port.handle);
  const raw = ports.length === 1 && ports[0] === 'str';
  return <NodeFrame id={id} tabId={data.tabId as string} label={config.label} selected={selected}
    color="#75beff" inputs={[{ id: 'in', domain: 'bytes' }]}
    outputs={[{ id: 'out', domain: 'bytes' }, ...ports.map((name) => ({
      id: name,
      domain: describeDomainToUi(description?.outputs.find((p) => p.handle === name)?.domain ?? 'F32'),
    }))]}
    onRemove={() => treeRootId ? removeDeviceTreeChild(treeRootId, id) : remove(id)}
    onRename={(label) => { if (treeRootId) updateDeviceTreeChild(treeRootId, id, { name: label }); else rename(id, label); }}
    onOpen={treeRootId ? () => useAppStore.getState().revealDeviceTreeNode(id) : undefined}>
    {treeRootId && <button type="button" className="nodrag text-accent text-[10px] hover:underline"
      onClick={() => useAppStore.getState().revealDeviceTreeNode(id)}>{translate('deviceTreeConfigure', lang)}</button>}
    <div className="text-center text-text-secondary">{raw ? 'str' : `${ports.length} ${translate('channels', lang)}`}</div>
    {config.convertTo && <div className="text-center text-text-secondary">→ {config.convertTo.kind}</div>}
  </NodeFrame>;
});

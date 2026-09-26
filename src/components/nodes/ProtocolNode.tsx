import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useAppStore } from '../../store/appStore';
import { t } from '../../i18n';
import type { ProtocolNodeData } from '../../store/appStoreHelpers';
import { isRawDataPreset, protocolPortNames } from '../../lib/utils/protocolSchema';
import { NodeFrame } from './NodeFrame';
import { removeDeviceTreeChild, updateDeviceTreeChild } from '../../lib/acquisition/deviceTree';

export const ProtocolNode = memo(function ProtocolNode({ id, data, selected }: NodeProps) {
  const lang = useAppStore((s) => s.lang);
  const remove = useAppStore((s) => s.removeNode);
  const rename = useAppStore((s) => s.renameNode);
  const derived = useAppStore((s) => s.derivedPorts[id]);
  const detected = useAppStore((s) => s.detectedChannels[id] ?? null);
  const config = data as ProtocolNodeData;
  const treeRootId = typeof data.treeRootId === 'string' ? data.treeRootId : null;
  const ports = derived?.ports.map((port) => port.name) ?? protocolPortNames(config, detected);
  const raw = isRawDataPreset(config);
  return <NodeFrame id={id} tabId={data.tabId as string} label={config.label} selected={selected}
    color="#75beff" inputs={[{ id: 'in', domain: 'bytes' }]}
    outputs={[{ id: 'out', domain: 'bytes' }, ...ports.map((name) => ({ id: name, domain: raw && name === 'str' ? 'string' : 'time' }))]}
    onRemove={() => treeRootId ? removeDeviceTreeChild(treeRootId, id) : remove(id)}
    onRename={(label) => { if (treeRootId) updateDeviceTreeChild(treeRootId, id, { name: label }); else rename(id, label); }}
    onOpen={treeRootId ? () => useAppStore.getState().revealDeviceTreeNode(id) : undefined}>
    {treeRootId && <button type="button" className="nodrag text-accent text-[10px] hover:underline"
      onClick={() => useAppStore.getState().revealDeviceTreeNode(id)}>{t(lang, 'deviceTreeConfigure')}</button>}
    <div className="text-center text-text-secondary">{raw ? 'str' : `${ports.length} ${t(lang, 'channels')}`}</div>
    {config.convertTo && <div className="text-center text-text-secondary">→ {config.convertTo.kind}</div>}
  </NodeFrame>;
});

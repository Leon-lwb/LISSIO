import { memo, useEffect, useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { NodeFrame } from './NodeFrame';
import { updateAcquisitionNode } from '../../lib/acquisition/acquisitionNodes';
import { useAppStore } from '../../store/appStore';
import { simulationConfig, type AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';
import { useDeviceNodeSnapshot } from '../../lib/acquisition/useDeviceNodeSnapshot';
import { loadAdapterCapabilities } from '../../lib/acquisition/capabilityCatalog';
import { buildDeviceCards, type DeviceCardModel } from '../../lib/acquisition/deviceCardModel';
import type { PortDescriptor } from '../../types';
import { translate } from '../../i18n';

function acceptsInput(port: PortDescriptor): boolean {
  return port.direction === 'input' || port.direction === 'bidirectional';
}

function acceptsOutput(port: PortDescriptor): boolean {
  return port.direction === 'output' || port.direction === 'bidirectional';
}

/// 回退端口的操作位 — 字节源/汇即可连线 (真实能力以后端图编译为准)
const FALLBACK_OPERATIONS = {
  byteSource: true, byteSink: true, discover: false, browse: false,
  read: false, subscribe: false, write: false, method: false,
};


export const AcquisitionNode = memo(function AcquisitionNode({ id, data, selected }: NodeProps) {
  const lang = useAppStore((s) => s.lang);
  const remove = useAppStore((s) => s.removeNode);
  const snapshot = useDeviceNodeSnapshot(id);
  const { node: device, card: initialCard } = data as AcquisitionNodeData;
  const [card, setCard] = useState<DeviceCardModel | undefined>(initialCard);
  const [cardError, setCardError] = useState(false);

  useEffect(() => {
    setCard(initialCard);
    if (initialCard) {
      setCardError(false);
      return;
    }
    let active = true;
    void loadAdapterCapabilities().then((adapters) => {
      const adapter = adapters.find((item) => item.adapterId === device.driver);
      const next = adapter && buildDeviceCards([adapter]).find((item) =>
        item.endpoint.id === device.capabilityEndpointId
        || (!device.capabilityEndpointId && adapter.endpoints.length === 1));
      if (active) {
        setCardError(!next);
        setCard(next);
        if (next) useAppStore.setState(s => ({ rfNodes: s.rfNodes.map(n => n.id === id ? { ...n, data: { ...n.data,
          card: next, ports: next.endpoint.ports.map(p => ({ id: p.id, direction: p.direction, domain: p.dataDomain })),
        } } : n) }));
      }
    }).catch(() => { if (active) setCardError(true); });
    return () => { active = false; };
  }, [id, initialCard, device.driver, device.capabilityEndpointId]);

  // 卡片解析失败时回退字节端口 (tx/rx): 无端口会让节点完全无法连线,
  // 而字节驱动的端口形态是稳定的; 失败本身仍以徽标显式暴露。
  const ports = useMemo(() => card?.endpoint.ports ?? (cardError ? [
    { id: 'tx', displayName: 'tx', direction: 'input' as const, dataDomain: 'bytes' as const,
      operations: FALLBACK_OPERATIONS, addressSpace: null, dataTypes: [], display: null },
    { id: 'rx', displayName: 'rx', direction: 'output' as const, dataDomain: 'bytes' as const,
      operations: FALLBACK_OPERATIONS, addressSpace: null, dataTypes: [], display: null },
  ] : []), [card, cardError]);
  const inputPorts = useMemo(() => ports.filter(acceptsInput), [ports]);
  const outputPorts = useMemo(() => ports.filter(acceptsOutput), [ports]);
  const online = snapshot?.state.state === 'online';
  const failed = snapshot?.state.state === 'degraded';
  const waiting = snapshot != null && !online && snapshot.state.state !== 'closed' && !failed;
  const stateLabel = online ? 'connected' : failed ? 'connError' : waiting ? 'connecting' : 'notConnected';
  return <NodeFrame id={id} tabId={data.tabId as string} label={device.name} selected={selected}
    color="#e5c07b" inputs={inputPorts.map((port) => ({ id: port.id, label: port.displayName, domain: port.dataDomain }))}
    outputs={outputPorts.map((port) => ({ id: port.id, label: port.displayName, domain: port.dataDomain }))}
    onRename={(label) => updateAcquisitionNode(id, { ...device, name: label })} onRemove={() => remove(id)}
    status={<span className={online ? 'text-green' : failed ? 'text-red' : 'text-text-secondary'}>{translate(stateLabel, lang)}</span>}>
    {simulationConfig(device) && <span className="text-center text-yellow">{translate('testData', lang)}</span>}
    {cardError && <span className="text-center text-red" title={translate('acquisitionCardMissing', lang)}>{translate('acquisitionCardMissing', lang)}</span>}
    <div className="text-center text-text-secondary">{card?.adapter.displayName}</div>
  </NodeFrame>;
});

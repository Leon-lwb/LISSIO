import { memo, useEffect, useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { NodeFrame } from './NodeFrame';
import { updateAcquisitionNode } from '../../lib/acquisition/acquisitionNodes';
import { useAppStore } from '../../store/appStore';
import type { AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';
import { useEndpointSnapshot } from '../../lib/acquisition/useEndpointSnapshot';
import { loadAdapterCapabilities } from '../../lib/acquisition/capabilityCatalog';
import { buildDeviceCards, type DeviceCardModel } from '../../lib/acquisition/deviceCardModel';
import type { PortDescriptor } from '../../types';
import { t } from '../../i18n';

function acceptsInput(port: PortDescriptor): boolean {
  return port.direction === 'input' || port.direction === 'bidirectional';
}

function acceptsOutput(port: PortDescriptor): boolean {
  return port.direction === 'output' || port.direction === 'bidirectional';
}


export const AcquisitionNode = memo(function AcquisitionNode({ id, data, selected }: NodeProps) {
  const lang = useAppStore((s) => s.lang);
  const remove = useAppStore((s) => s.removeNode);
  const snapshot = useEndpointSnapshot(id);
  const { spec, card: initialCard } = data as AcquisitionNodeData;
  const [card, setCard] = useState<DeviceCardModel | undefined>(initialCard);

  useEffect(() => {
    setCard(initialCard);
    if (initialCard) return;
    let active = true;
    void loadAdapterCapabilities().then((adapters) => {
      const adapter = adapters.find((item) => item.adapterId === spec.driver.driverId);
      const next = adapter && buildDeviceCards([adapter]).find((item) =>
        item.endpoint.id === spec.capabilityEndpointId
        || (!spec.capabilityEndpointId && adapter.endpoints.length === 1));
      if (active) {
        setCard(next);
        if (next) useAppStore.setState(s => ({ rfNodes: s.rfNodes.map(n => n.id === id ? { ...n, data: { ...n.data,
          card: next, ports: next.endpoint.ports.map(p => ({ id: p.id, direction: p.direction, domain: p.dataDomain })),
        } } : n) }));
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [id, initialCard, spec.driver.driverId, spec.capabilityEndpointId]);

  const ports = card?.endpoint.ports ?? [];
  const inputPorts = useMemo(() => ports.filter(acceptsInput), [ports]);
  const outputPorts = useMemo(() => ports.filter(acceptsOutput), [ports]);
  const online = snapshot?.state.state === 'online';
  const failed = snapshot?.state.state === 'degraded';
  const waiting = snapshot != null && !online && snapshot.state.state !== 'closed' && !failed;
  const stateLabel = online ? 'connected' : failed ? 'connError' : waiting ? 'connecting' : 'notConnected';
  return <NodeFrame id={id} tabId={data.tabId as string} label={spec.label} selected={selected}
    color="#e5c07b" inputs={inputPorts.map((port) => ({ id: port.id, label: port.displayName, domain: port.dataDomain }))}
    outputs={outputPorts.map((port) => ({ id: port.id, label: port.displayName, domain: port.dataDomain }))}
    onRename={(label) => updateAcquisitionNode(id, { ...spec, label })} onRemove={() => remove(id)}
    status={<span className={online ? 'text-green' : failed ? 'text-red' : 'text-text-secondary'}>{t(lang, stateLabel)}</span>}>
    {spec.simulation && <span className="text-center text-yellow">{t(lang, 'testData')}</span>}
    <div className="text-center text-text-secondary">{card?.adapter.displayName}</div>
  </NodeFrame>;
});

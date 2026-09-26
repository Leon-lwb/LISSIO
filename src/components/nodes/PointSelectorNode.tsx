import { useEffect, useState } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { NodeFrame } from './NodeFrame';
import { useAppStore } from '../../store/appStore';
import { withHistoryOp } from '../../store/historyStore';
import { api } from '../../lib/tauri/tauri';
import type { PointDescriptor } from '../../types';
import type { AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';

export function PointSelectorNode({ id, data, selected }: NodeProps) {
  const points = data.points as string[];
  return <NodeFrame id={id} tabId={data.tabId as string} label={data.label as string} selected={selected} color="#89d185"
    inputs={[{ id: 'points', domain: 'points' }]} outputs={points.map(id => ({ id, domain: 'time' }))}
    onRename={label => useAppStore.getState().renameNode(id, label)} onRemove={() => useAppStore.getState().removeNode(id)}>
    <span className="text-text-secondary text-center">{points.length} 个点位 · 数值投影</span>
  </NodeFrame>;
}

export function PointSelectorProperties({ node }: { node: Node }) {
  const edges = useAppStore(s => s.rfEdges);
  const sourceId = edges.find(e => e.target === node.id && e.targetHandle === 'points')?.source;
  const source = useAppStore(s => s.rfNodes.find(n => n.id === sourceId));
  const device = (source?.data as AcquisitionNodeData | undefined)?.node;
  const [descriptors, setDescriptors] = useState<PointDescriptor[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setDescriptors([]); setError('');
    if (device) void api.describeAcquisitionPoints({ driverId: device.driver, schemaVersion: device.schemaVersion, payload: device.config }).then(points => { if (active) setDescriptors(points); }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [device]);
  const points = node.data.points as string[];
  const update = (points: string[]) => withHistoryOp({ opKey: 'opUpdateWidget' }, () => {
    const state = useAppStore.getState();
    useAppStore.setState({ rfNodes: state.rfNodes.map(n => n.id === node.id ? { ...n, data: { ...n.data, points } } : n),
      rfEdges: state.rfEdges.filter(e => e.source !== node.id || points.includes(e.sourceHandle ?? '')) });
    state.syncAllTabGraphs();
  });
  return <div className="text-xs flex flex-col gap-2">
    {!source && <p>先连接一个设备的 points 输出。</p>}
    {descriptors.map(point => <label className="flex items-center gap-2" key={point.id}><input type="checkbox" checked={points.includes(point.id)} onChange={e => update(e.target.checked ? [...points, point.id] : points.filter(id => id !== point.id))} />{point.name} · {point.dataType}</label>)}
    {points.filter(id => !descriptors.some(p => p.id === id)).map(id => <div key={id} className="text-red">{id} · 点位缺失 <button onClick={() => update(points.filter(p => p !== id))}>移除输出</button></div>)}
    {error && <p role="alert" className="text-red">{error}</p>}
    <p className="text-text-secondary">布尔值转为 0/1；坏质量与溢出不输出有效数值。原始类型与质量保留在设备中。</p>
  </div>;
}

import type { Node } from '@xyflow/react';
import { useAppStore } from '../../store/appStore';
import type { SimulationConfig, SignalParameters } from '../../types';
import { simulationConfig, updateAcquisitionNode, withSimulation, type AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';
import { DraftNumberInput } from '../ui/fields';
import { downstreamParsers, resolveSimulation, applyTestAttribute } from '../../lib/acquisition/simulation';

export function SimulationProperties({ node }: { node: Node }) {
  const nodes = useAppStore(s => s.rfNodes);
  const edges = useAppStore(s => s.rfEdges);
  const { node: device, ports } = node.data as AcquisitionNodeData;
  const config = simulationConfig(device);
  if (!config) return <button className="form-input" onClick={() => applyTestAttribute(node.id)}>添加测试数据属性</button>;
  const update = (patch: Partial<SimulationConfig>) => updateAcquisitionNode(node.id, withSimulation(device, { ...config, ...patch }));
  const parsers = downstreamParsers(node, nodes, edges);
  const pointSource = ports?.some(p => p.domain === 'points');
  let error = '';
  try { resolveSimulation(node, nodes, edges); } catch (cause) { error = String(cause); }
  const signals = ['sine', 'square', 'triangle', 'sawtooth', 'random', 'dc'] as const;
  const signalFields = (signal: SignalParameters, onChange: (signal: SignalParameters) => void, idPrefix: string) => <div className="grid grid-cols-2 gap-2">
    <label>波形<select className="form-select" value={signal.waveform} onChange={e => onChange({ ...signal, waveform: e.target.value as SignalParameters['waveform'] })}>{signals.map(s => <option key={s}>{s}</option>)}</select></label>
    {(['frequency', 'amplitude', 'offset'] as const).map(key => <label key={key} htmlFor={`${idPrefix}-${key}`}>{({ frequency: '频率 Hz', amplitude: '幅值', offset: '偏移' })[key]}<DraftNumberInput id={`${idPrefix}-${key}`} className="form-input" step="any" value={signal[key]} onCommit={v => onChange({ ...signal, [key]: v })} /></label>)}
  </div>;
  return <div className="flex flex-col gap-3 text-xs">
    <div className="flex justify-between"><span>测试数据 · 不访问真实硬件</span><button className="text-red" onClick={() => updateAcquisitionNode(node.id, withSimulation(device, null))}>移除</button></div>
    {signalFields(config.signal, signal => update({ signal }), 'sim-signal')}
    <div className="grid grid-cols-2 gap-2">
      <label htmlFor="sim-sampleRate">生成速率 / 秒<DraftNumberInput id="sim-sampleRate" className="form-input" min={1} max={5000000} value={config.sampleRate} onCommit={sampleRate => update({ sampleRate })} /></label>
      <label htmlFor="sim-seed">随机种子<DraftNumberInput id="sim-seed" className="form-input" min={0} max={4294967295} integer value={config.seed} onCommit={seed => update({ seed })} /></label>
      {!pointSource && <label htmlFor="sim-channels">通道数<DraftNumberInput id="sim-channels" className="form-input" min={1} max={256} integer value={config.channels} onCommit={channels => update({ channels })} /></label>}
    </div>
    {!pointSource && (parsers.length ? <label>参考解析器<select className="form-select" value={config.referenceNodeId ?? ''} onChange={e => update({ referenceNodeId: e.target.value || null })}>
      <option value="">自动匹配唯一格式</option>{parsers.map(p => <option key={p.id} value={p.id}>{typeof p.data.label === 'string' ? p.data.label : p.id}</option>)}
    </select></label> : <label>生成格式<select className="form-select" value={(config.encoding as { protocol?: { kind: string } } | null)?.protocol?.kind ?? ''} onChange={e => update({ encoding: e.target.value ? { protocol: { kind: e.target.value, channels: config.channels }, schema: null } : null })}>
      <option value="">请选择</option><option>JustFloat</option><option>FireWater</option><option>RawData</option>
    </select></label>)}
    <details><summary className="cursor-pointer">逐通道 / 点位覆盖</summary>
      {Object.entries(config.overrides).map(([id, signal], index) => <div key={id} className="mt-2 border-t border-border pt-2"><div className="flex justify-between"><span>{id}</span><button onClick={() => { const overrides = { ...config.overrides }; delete overrides[id]; update({ overrides }); }}>删除覆盖</button></div>{signalFields(signal, value => update({ overrides: { ...config.overrides, [id]: value } }), `sim-override-${index}`)}</div>)}
      <form className="flex gap-1 mt-2" onSubmit={e => { e.preventDefault(); const input = e.currentTarget.elements.namedItem('point') as HTMLInputElement; const id = input.value.trim(); if (id) update({ overrides: { ...config.overrides, [id]: { ...config.signal } } }); input.value = ''; }}><input name="point" className="form-input" placeholder="稳定点位 ID 或 ch0" /><button type="submit">添加</button></form>
    </details>
    {error && <p role="alert" className="text-red">{error}</p>}
    <p className="text-text-secondary">添加、移除属性或更改格式后需手动重新连接。模拟写入不受支持。</p>
  </div>;
}

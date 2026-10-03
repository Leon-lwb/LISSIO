import { useState } from 'react';
import type { Node } from '@xyflow/react';
import { translate } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import type { DeviceTreeNodeDecl, DriverManifestProjection, ProtocolConfig, ProtocolSchema, SimulationConfig } from '../../types';
import { findDeviceTreeNode, updateDeviceTreeChild, validateDeviceTreeName, type DeviceTreeItem } from '../../lib/acquisition/deviceTree';
import type { AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';
import { prepareProtocolDocument } from '../../lib/models/createFromCatalog';
import { openNodePropertiesPanel } from '../../lib/utils/revealDataTab';
import { ProtocolConfigForm } from '../panels/protocol/ProtocolConfigForm';
import { SchemaFields } from './SchemaFields';
import { asFormSchema } from '../../lib/acquisition/schemaForm';
import { SimulationNodeFields } from './SimulationNodeFields';

export function DeviceTreeInspector({ item, root, manifest }: {
  item: DeviceTreeItem;
  root?: Node;
  manifest?: DriverManifestProjection;
}) {
  const lang = useAppStore(s => s.lang);
  const [name, setName] = useState(item.name);
  const [error, setError] = useState('');
  const device = item.node;
  const change = (patch: Partial<DeviceTreeNodeDecl>) => {
    if (!updateDeviceTreeChild(item.rootId, item.id, patch)) setError(translate('deviceTreeInvalidName', lang));
    else setError('');
  };
  // 表单可能连续提交协议和 schema，始终基于最新树合并，避免闭包覆盖前一次写入。
  const configChange = (patch: Record<string, unknown>) => {
    const currentRoot = useAppStore.getState().rfNodes.find(n => n.id === item.rootId);
    const current = currentRoot && findDeviceTreeNode((currentRoot.data as AcquisitionNodeData).node, item.id);
    if (current) change({ config: { ...(current.config as Record<string, unknown>), ...patch } });
  };
  if (!device) return <div className="space-y-3 text-xs">
    <p className="text-text-secondary">{translate('deviceTreeCanvasNode', lang)}</p>
    <button type="button" className="form-input" onClick={() => {
      const state = useAppStore.getState();
      state.onNodesChange(state.rfNodes.map(n => ({ id: n.id, type: 'select', selected: n.id === item.canvasNodeId })));
      openNodePropertiesPanel();
    }}>{translate('deviceTreeEditCanvas', lang)}</button>
  </div>;

  const config = device.config as { protocol?: ProtocolConfig; schema?: ProtocolSchema | null; convertTo?: ProtocolConfig | null };
  return <div className="flex flex-col gap-3 text-xs">
    <label>{translate('widgetName', lang)}
      <input className="form-input mt-1" value={name} aria-invalid={!!error}
        onChange={event => setName(event.target.value)} onBlur={() => {
          const rootDecl = (root?.data as AcquisitionNodeData | undefined)?.node;
          if (!rootDecl || validateDeviceTreeName(rootDecl, item.id, name.trim())) {
            setError(translate('deviceTreeInvalidName', lang)); return;
          }
          change({ name: name.trim() });
        }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </label>
    {error && <p role="alert" className="text-red">{error}</p>}
    <label className="flex items-center gap-2"><input type="checkbox" checked={device.enabled}
      onChange={event => change({ enabled: event.target.checked })} />{translate('deviceTreeEnabled', lang)}</label>
    <div className="rounded bg-bg-inset px-2 py-1.5 text-text-muted break-all"><span>{translate('deviceTreeDriver', lang)}: </span><code>{device.driver}</code></div>
    {device.driver === 'protocol-engine' && config.protocol ? <>
      <ProtocolConfigForm value={config.protocol} lang={lang} nameSuffix={`-tree-${item.id}`}
        schema={config.schema ?? undefined}
        onChange={protocol => {
          // 预设 schema 单一来源 = 目录 prepare; custom 保留用户块
          if (config.schema?.preset === 'custom') {
            configChange({ protocol });
            return;
          }
          void prepareProtocolDocument(protocol)
            .then(prepared => configChange({ protocol: prepared.protocol, schema: prepared.schema }))
            .catch(() => undefined);
        }}
        onSchemaChange={schema => configChange({ schema })} />
      <label>{translate('convertTo', lang)}
        <select className="form-select mt-1" value={config.convertTo?.kind ?? ''} onChange={event => {
          const kind = event.target.value;
          configChange({ convertTo: !kind ? null : kind === 'RawData' ? { kind } : { kind, channels: null } });
        }}>
          <option value="">{translate('convertNone', lang)}</option>
          {['JustFloat', 'FireWater', 'RawData'].map(value => <option key={value}>{value}</option>)}
        </select>
      </label>
    </> : device.driver === 'simulation' ? <SimulationNodeFields config={device.config as SimulationConfig}
      onChange={patch => configChange(patch)} />
      : manifest && Object.keys(asFormSchema(manifest.configSchema.jsonSchema)?.properties ?? {}).length > 0
        ? <SchemaFields schema={manifest.configSchema.jsonSchema} uiHints={manifest.configSchema.uiHints}
          value={device.config} path={`device-tree-${device.id}`} onChange={value => change({ config: value })} />
        : <JsonConfig config={device.config as Record<string, unknown>} onChange={value => change({ config: value })} />}
    <p className="text-[11px] leading-relaxed text-text-muted">{translate('deviceTreeReconnect', lang)}</p>
  </div>;
}

function JsonConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (config: Record<string, unknown>) => void }) {
  const lang = useAppStore(s => s.lang);
  const [draft, setDraft] = useState(JSON.stringify(config, null, 2));
  const [error, setError] = useState('');
  return <div className="space-y-2">
    <label className="block">{translate('deviceTreeJsonConfig', lang)}<textarea className="form-input mt-1 min-h-32 font-mono text-[11px]" value={draft}
      onChange={event => setDraft(event.target.value)} spellCheck={false} /></label>
    <button type="button" className="form-input" onClick={() => {
      try {
        const value: unknown = JSON.parse(draft);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
        onChange(value as Record<string, unknown>); setError('');
      } catch (cause) { setError(String(cause)); }
    }}>{translate('deviceTreeApply', lang)}</button>
    {error && <p role="alert" className="text-red break-all">{error}</p>}
  </div>;
}

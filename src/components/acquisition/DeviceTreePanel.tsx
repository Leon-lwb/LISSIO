import { useEffect, useMemo, useState } from 'react';
import { Binary, Cable, ChevronDown, ChevronRight, FlaskConical, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { t } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import type { DriverManifestProjection } from '../../types';
import { api } from '../../lib/tauri/tauri';
import { formatError } from '../../lib/tauri/notifications';
import { loadAdapterCapabilities } from '../../lib/acquisition/capabilityCatalog';
import { buildDeviceCards, type DeviceCardModel } from '../../lib/acquisition/deviceCardModel';
import { addAcquisitionNode, type AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';
import { prepareProtocolDocument } from '../../lib/models/createFromCatalog';
import {
  addDeviceTreeChild, buildDeviceTree, createProtocolEngineNode, createSimulationNode,
  removeDeviceTreeChild, type DeviceTreeItem,
} from '../../lib/acquisition/deviceTree';
import { refreshDeviceNodeSnapshots, useDeviceNodeSnapshot } from '../../lib/acquisition/useDeviceNodeSnapshot';
import { SearchInput } from '../ui/SearchInput';
import { DeviceTreeInspector } from './DeviceTreeInspector';
import { asFormSchema, defaultsFromSchema } from '../../lib/acquisition/schemaForm';
import { uniqueDeviceTreeName } from '../../lib/acquisition/deviceTree';
import { nanoid } from 'nanoid';

function flatten(items: DeviceTreeItem[]): DeviceTreeItem[] {
  return items.flatMap(item => [item, ...flatten(item.children)]);
}

function filterTree(items: DeviceTreeItem[], query: string): DeviceTreeItem[] {
  if (!query) return items;
  return items.flatMap(item => {
    if (`${item.name} ${item.driver} ${item.id}`.toLowerCase().includes(query)) return [item];
    const children = filterTree(item.children, query);
    return children.length ? [{ ...item, children }] : [];
  });
}

export function DeviceTreePanel() {
  const lang = useAppStore(s => s.lang);
  const nodes = useAppStore(s => s.rfNodes);
  const edges = useAppStore(s => s.rfEdges);
  const tabId = useAppStore(s => s.activeControlTabId);
  const selectedId = useAppStore(s => s.selectedDeviceTreeNodeId);
  const select = useAppStore(s => s.revealDeviceTreeNode);
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState<DeviceCardModel[]>([]);
  const [manifests, setManifests] = useState<DriverManifestProjection[]>([]);
  const [driverKey, setDriverKey] = useState('');
  const [childDriver, setChildDriver] = useState('');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setPending(true); setError('');
    void Promise.allSettled([loadAdapterCapabilities(attempt > 0), api.listDriverManifests()]).then(([catalog, drivers]) => {
      if (!active) return;
      if (catalog.status === 'fulfilled') setCards(buildDeviceCards(catalog.value));
      if (drivers.status === 'fulfilled') setManifests(drivers.value);
      const failure: unknown = catalog.status === 'rejected' ? catalog.reason : drivers.status === 'rejected' ? drivers.reason : null;
      if (failure != null) setError(formatError(failure));
      setPending(false);
    });
    return () => { active = false; };
  }, [attempt]);

  const tree = useMemo(() => buildDeviceTree(nodes, edges, tabId), [nodes, edges, tabId]);
  const selected = flatten(tree).find(item => item.id === selectedId);
  const root = nodes.find(node => node.id === selected?.rootId);
  const manifest = manifests.find(item => item.driverId === selected?.driver);
  const visible = filterTree(tree, query.trim().toLowerCase());
  const rootCards = cards.filter(card => card.endpoint.status.state !== 'unavailable');
  const card = rootCards.find(item => item.key === driverKey) ?? rootCards[0];
  const rootData = root?.data as AcquisitionNodeData | undefined;
  const hasByteOutput = Boolean(rootData?.ports?.some(port => port.domain === 'bytes' && port.direction !== 'input'));
  const childOptions = selected?.node && manifest?.childPolicy ? manifests.filter(candidate => {
    const limit = manifest.childPolicy?.allowed[candidate.role];
    if (!limit || candidate.driverId === 'protocol-engine' || candidate.driverId === 'simulation') return false;
    const count = selected.node!.children.filter(child => manifests.find(entry => entry.driverId === child.driver)?.role === candidate.role).length;
    return (limit.maximum == null || count < limit.maximum);
  }) : [];
  const canAddProtocol = !!selected?.node && (manifest?.childPolicy?.allowed.protocol != null || !manifest) && (Boolean(manifest?.capabilities.byteSource)
    || selected.driver === 'protocol-engine'
    || (selected.driver === 'simulation' && hasByteOutput)
    || (selected.id === root?.id && hasByteOutput));
  const canAddSimulation = !!selected?.node && selected.id === root?.id
    && selected.driver !== 'test-data' && selected.driver !== 'simulation'
    && (manifest?.childPolicy?.allowed.virtual != null || !manifest)
    && !selected.node.children.some(child => child.driver === 'simulation');

  return <div className="flex h-full min-h-0 flex-col gap-3" data-testid="device-tree-panel">
    <p className="text-[11px] leading-relaxed text-text-muted">{t(lang, 'deviceTreeHint')}</p>
    <div className="flex gap-1">
      <select aria-label={t(lang, 'deviceTreeAddRoot')} className="form-select min-w-0 flex-1" value={card?.key ?? ''}
        disabled={pending || !rootCards.length} onChange={event => setDriverKey(event.target.value)}>
        {!rootCards.length && <option value="">{t(lang, 'deviceTreeAddRoot')}</option>}
        {rootCards.map(item => <option key={item.key} value={item.key}>{item.adapter.displayName}{item.adapter.endpoints.length > 1 ? ` · ${item.endpoint.displayName}` : ''}</option>)}
      </select>
      <button type="button" className="rounded bg-bg-button px-2 text-text-inverse disabled:opacity-40" title={t(lang, 'deviceTreeAddRoot')}
        aria-label={t(lang, 'deviceTreeAddRoot')} disabled={pending || !card} onClick={() => {
          if (!card) return;
          // 目录创建为异步 — 节点就绪后再选中
          void addAcquisitionNode(card, { x: 60, y: 80 + tree.length * 200 }, tabId)
            .then((node) => select(node.id))
            .catch(() => undefined);
        }}><Plus size={15} /></button>
      <button type="button" className="rounded p-1.5 text-text-secondary hover:bg-bg-hover disabled:opacity-40" disabled={pending}
        title={t(lang, 'refresh')} aria-label={t(lang, 'refresh')} onClick={() => { setAttempt(value => value + 1); void refreshDeviceNodeSnapshots(); }}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
      </button>
    </div>
    <button type="button" className="text-left text-[11px] text-accent hover:underline"
      onClick={() => useAppStore.getState().openCategory('transport')}>{t(lang, 'deviceTreeCatalog')}</button>
    {error && <p role="alert" className="text-[11px] text-red break-words">{t(lang, 'deviceTreeUnavailable')}: {error}</p>}
    <SearchInput value={query} onChange={setQuery} placeholder={t(lang, 'deviceTreeSearch')} />
    <div className="min-h-28 max-h-[45%] overflow-y-auto rounded-lg border border-border bg-bg-inset py-1">
      {tree.length === 0 ? <p className="px-3 py-6 text-center text-xs text-text-muted">{t(lang, 'deviceTreeEmpty')}</p>
        : visible.length === 0 ? <p role="status" className="p-3 text-xs text-text-muted">{t(lang, 'paletteNoResults')}</p>
          : <div role="tree" aria-label={t(lang, 'deviceTreeTitle')}>
            {visible.map(item => <DeviceTreeRow key={item.id} item={item} depth={0} selectedId={selectedId}
              select={select} forceExpanded={!!query.trim()} parentEnabled />)}
          </div>}
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto border-t border-border pt-3">
      {selected ? <>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0"><h3 className="truncate text-xs font-semibold text-text-primary">{selected.name}</h3>
            <code className="block truncate text-[10px] text-text-muted" title={selected.id}>{selected.id}</code></div>
          <button type="button" className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-red"
            title={t(lang, 'deviceTreeSubtreeHint')} aria-label={t(lang, 'deviceTreeRemove')} onClick={() => {
              if (selected.node && selected.id !== selected.rootId) removeDeviceTreeChild(selected.rootId, selected.id);
              else useAppStore.getState().removeNode(selected.canvasNodeId);
              useAppStore.setState({ selectedDeviceTreeNodeId: null });
            }}><Trash2 size={14} /></button>
        </div>
        <div className="mb-3 flex flex-col gap-1">
          {canAddProtocol && <button type="button" className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-[11px] hover:bg-bg-hover"
            onClick={() => {
              // 协议引擎子节点的 schema 单一来源 = 目录 prepare
              void prepareProtocolDocument({ kind: 'JustFloat', channels: null })
                .then((prepared) => {
                  const child = createProtocolEngineNode(selected.node!, { protocol: prepared.protocol, convertTo: null, schema: prepared.schema });
                  if (addDeviceTreeChild(selected.rootId, selected.id, child)) select(child.id);
                })
                .catch(() => undefined);
            }}><Binary size={13} />{t(lang, 'deviceTreeAddProtocol')}</button>}
          {canAddSimulation && <button type="button" className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-[11px] hover:bg-bg-hover"
            onClick={() => {
              const child = createSimulationNode(selected.node!);
              if (addDeviceTreeChild(selected.rootId, selected.id, child)) select(child.id);
            }}><FlaskConical size={13} />{t(lang, 'deviceTreeAddSimulation')}</button>}
          {childOptions.length > 0 && <div className="flex gap-1">
            <select className="form-select min-w-0 flex-1" aria-label={t(lang, 'deviceTreeAddChild')}
              value={childOptions.some(option => option.driverId === childDriver) ? childDriver : childOptions[0].driverId}
              onChange={event => setChildDriver(event.target.value)}>
              {childOptions.map(option => <option key={option.driverId} value={option.driverId}>{option.driverId}</option>)}
            </select>
            <button type="button" className="rounded border border-border px-2 hover:bg-bg-hover" aria-label={t(lang, 'deviceTreeAddChild')}
              onClick={() => {
                const driver = childOptions.find(option => option.driverId === childDriver) ?? childOptions[0];
                const parent = selected.node!;
                const child = { id: `device-${nanoid(8)}`, name: uniqueDeviceTreeName(parent, driver.driverId),
                  driver: driver.driverId, schemaVersion: driver.configSchema.schemaVersion,
                  config: defaultsFromSchema(asFormSchema(driver.configSchema.jsonSchema) ?? {}) as Record<string, unknown>, enabled: true, children: [] };
                if (addDeviceTreeChild(selected.rootId, selected.id, child)) select(child.id);
              }}><Plus size={14} /></button>
          </div>}
        </div>
        {root?.type === 'acquisition' && <DeviceConnection rootId={root.id} enabled={rootData?.node.enabled ?? false} />}
        <DeviceTreeInspector key={selected.id} item={selected} root={root} manifest={manifest} />
      </> : <p className="py-6 text-center text-xs text-text-muted">{t(lang, 'deviceTreeSelect')}</p>}
    </div>
  </div>;
}

function DeviceConnection({ rootId, enabled }: { rootId: string; enabled: boolean }) {
  const lang = useAppStore(s => s.lang);
  const snapshot = useDeviceNodeSnapshot(rootId);
  const connection = useAppStore(s => s.connectionStates[rootId]);
  const [pending, setPending] = useState(false);
  const opened = snapshot && !['disabled', 'closed'].includes(snapshot.state.state);
  return <div className="mb-3">
    <button type="button" className="w-full rounded bg-bg-button py-2 text-xs text-text-inverse disabled:opacity-40"
      disabled={pending || (!opened && !enabled)} onClick={() => {
        setPending(true);
        const store = useAppStore.getState();
        void (opened ? store.disconnectNode(rootId) : store.connectNode(rootId))
          .finally(() => { setPending(false); void refreshDeviceNodeSnapshots(); });
      }}>{t(lang, pending ? 'connecting' : opened ? 'disconnect' : 'connect')}</button>
    {(snapshot?.issue != null || connection === 'Error') && <p role="alert" className="mt-1 break-words text-[11px] text-red">
      {snapshot?.issue?.detail ?? t(lang, 'deviceTreeFailed')}
    </p>}
  </div>;
}

function DeviceTreeRow({ item, depth, selectedId, select, forceExpanded, parentEnabled }: {
  item: DeviceTreeItem; depth: number; selectedId: string | null; select: (id: string) => void;
  forceExpanded: boolean; parentEnabled: boolean;
}) {
  const lang = useAppStore(s => s.lang);
  const [expanded, setExpanded] = useState(true);
  const snapshot = useDeviceNodeSnapshot(item.id);
  const active = parentEnabled && item.enabled;
  const open = forceExpanded || expanded;
  const state = !active ? 'deviceTreeDisabled' : snapshot?.state.state === 'online' ? 'deviceTreeOnline'
    : snapshot?.state.state === 'degraded' ? 'deviceTreeFailed'
      : snapshot && !['closed', 'disabled'].includes(snapshot.state.state) ? 'deviceTreeBusy' : 'deviceTreeClosed';
  const Icon = /simulation|test.data/.test(item.driver) ? FlaskConical : /protocol|decoder/.test(item.driver) ? Binary : Cable;
  return <div role="treeitem" aria-selected={selectedId === item.id} aria-expanded={item.children.length ? open : undefined}>
    <div className={`flex items-center gap-1 rounded px-1 py-1.5 text-xs ${selectedId === item.id ? 'bg-bg-active text-text-bright' : 'text-text-secondary hover:bg-bg-hover'} ${!active ? 'opacity-50' : ''}`}
      style={{ paddingLeft: 4 + depth * 14 }}>
      {item.children.length ? <button type="button" className="shrink-0 rounded hover:bg-bg-hover" aria-label={t(lang, open ? 'deviceTreeCollapse' : 'deviceTreeExpand')}
        onClick={() => setExpanded(value => !value)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="w-[13px] shrink-0" />}
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => select(item.id)}
        title={`${item.name}\n${item.driver}\n${t(lang, state)}`} onKeyDown={event => {
          if (event.key === 'ArrowRight') { setExpanded(true); event.preventDefault(); }
          if (event.key === 'ArrowLeft') { setExpanded(false); event.preventDefault(); }
        }}>
        <Icon size={13} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{item.name}</span>
        {item.source === 'canvas' && <span className="rounded bg-bg-subtle px-1 text-[9px] text-text-muted">{t(lang, 'deviceTreeCanvasBadge')}</span>}
        <span aria-label={t(lang, state)} className={`mr-1 h-1.5 w-1.5 shrink-0 rounded-full ${state === 'deviceTreeOnline' ? 'bg-green' : state === 'deviceTreeFailed' ? 'bg-red' : 'bg-text-muted'}`} />
      </button>
    </div>
    {open && item.children.length > 0 && <div role="group">{item.children.map(child => <DeviceTreeRow key={child.id} item={child} depth={depth + 1}
      selectedId={selectedId} select={select} forceExpanded={forceExpanded} parentEnabled={active} />)}</div>}
  </div>;
}

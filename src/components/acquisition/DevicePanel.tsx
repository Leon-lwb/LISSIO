import { useState } from 'react';
import { Bluetooth, Cable, Loader2, Plus, RefreshCw } from 'lucide-react';
import { t } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import type { DeviceCardModel } from '../../lib/acquisition/deviceCardModel';
import { addAcquisitionNode } from '../../lib/acquisition/acquisitionNodes';
import { dockDrag } from '../../lib/dockDrag';
import { endpointHardwareDetails, endpointSubtitle, endpointTypeLabel } from './discoveredEndpoints';
import { adapterLabel, groupDevices, type DeviceOption, type PanelDevice } from './devicePanelModel';
import { useDeviceDiscovery } from './useDeviceDiscovery';

export function DevicePanel({ cards, query }: { cards: DeviceCardModel[]; query: string }) {
  const lang = useAppStore((s) => s.lang);
  const { discoveries, pending, errors, refresh } = useDeviceDiscovery(cards);
  const [added, setAdded] = useState('');
  const devices = groupDevices(cards, discoveries);
  const visible = devices.filter((device) => device.options.some(({ card, endpoint }) => {
    const hardware = endpointHardwareDetails(endpoint);
    return [adapterLabel(card), endpoint.displayName, endpoint.discoveryId, hardware.vidPid,
      hardware.manufacturer, hardware.serialNumber, endpointTypeLabel(endpoint, lang),
      endpoint.metadata.description, endpoint.metadata.product].join(' ').toLowerCase().includes(query);
  }));
  const manualCards = cards.filter((card) => adapterLabel(card).toLowerCase().includes(query));
  const add = ({ card, endpoint }: DeviceOption) => {
    addAcquisitionNode(card, { x: 60, y: 60 + Math.random() * 100 }, undefined, endpoint);
    setAdded(endpoint.displayName);
  };
  return (
    <div className="flex flex-col gap-3 px-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-medium text-text-secondary">{t(lang, 'devicePanelDevices')} <span className="ml-1 text-text-muted tabular-nums">{visible.length}</span></span>
        <button type="button" disabled={pending} onClick={() => { void refresh(); }} aria-label={t(lang, 'refresh')}
          title={t(lang, 'refresh')} className="rounded p-1.5 text-text-secondary hover:bg-bg-hover disabled:opacity-40">
          {pending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>
      <p className="px-1 text-[11px] leading-relaxed text-text-muted">{t(lang, 'devicePanelHint')}</p>
      <div className="flex flex-col gap-2">
        {visible.map((device) => <DeviceRow key={device.id} device={device} disabled={pending} onAdd={add} />)}
        {visible.length === 0 && <p role="status" className="rounded-lg border border-dashed border-border px-2 py-5 text-center text-[11px] text-text-muted">
          {t(lang, pending ? 'capabilityDiscovering' : query ? 'paletteNoResults' : 'capabilityNoEndpointsDiscovered')}
        </p>}
        {errors.map((error) => <p key={error} role="alert" className="break-words text-[11px] text-red">{error}</p>)}
      </div>
      {added && <p role="status" className="truncate px-1 text-[11px] text-green">{t(lang, 'devicePanelAdded')} {added}</p>}
      {manualCards.length > 0 && <details className="border-t border-border pt-2" open={query ? true : undefined}>
        <summary className="cursor-pointer py-1 text-[11px] text-text-secondary">{t(lang, 'devicePanelManualConnections')}</summary>
        <div className="mt-2 flex flex-col gap-1">
          {manualCards.map((card) => <button key={card.key} type="button" disabled={card.endpoint.status.state === 'unavailable'}
            onPointerDown={(event) => {
              if (event.button !== 0 || card.endpoint.status.state === 'unavailable') return;
              dockDrag.begin(event, { kind: 'widget', widget: { nodeType: 'acquisition', acquisition: card }, label: adapterLabel(card) });
            }}
            onClick={() => {
              if (dockDrag.consumeClick()) return;
              addAcquisitionNode(card);
              setAdded(adapterLabel(card));
            }} className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-40">
            <Cable size={13} /><span className="min-w-0 flex-1 truncate">{adapterLabel(card)}</span><Plus size={12} />
          </button>)}
        </div>
      </details>}
    </div>
  );
}

function DeviceRow({ device, disabled, onAdd }: { device: PanelDevice; disabled: boolean; onAdd: (option: DeviceOption) => void }) {
  const lang = useAppStore((s) => s.lang);
  const [selected, setSelected] = useState(device.options[0].card.key);
  const option = device.options.find(({ card }) => card.key === selected) ?? device.options[0];
  const { endpoint } = option;
  const hardware = endpointHardwareDetails(endpoint);
  const subtitle = endpointSubtitle(endpoint);
  const typeLabel = endpointTypeLabel(endpoint, lang);
  const Icon = endpoint.metadata.portType === 'Bluetooth' ? Bluetooth : Cable;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-inset">
      <button type="button" disabled={disabled}
        onPointerDown={(event) => {
          if (event.button !== 0 || disabled) return;
          dockDrag.begin(event, { kind: 'widget', widget: {
            nodeType: 'acquisition', acquisition: option.card, discoveredEndpoint: endpoint,
          }, label: endpoint.displayName });
        }}
        onClick={() => { if (!dockDrag.consumeClick()) onAdd(option); }}
        title={`${t(lang, 'devicePanelAdd')}: ${endpoint.displayName}\n${endpoint.discoveryId}`}
        className="group cursor-grab active:cursor-grabbing select-none flex w-full items-start gap-2 px-2.5 py-3 text-left transition-colors hover:bg-bg-hover focus-visible:outline-accent disabled:opacity-40">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-yellow/15 text-yellow"><Icon size={15} /></span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block truncate text-xs font-medium text-text-primary" title={endpoint.displayName}>{endpoint.displayName}</span>
          {subtitle && <span className="block truncate font-mono text-[10px] text-text-muted" title={subtitle}>{subtitle}</span>}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-text-secondary">
            {typeLabel && <span title={endpoint.metadata.portType === 'Bluetooth' ? t(lang, 'deviceBluetoothNoUsbIds') : undefined}>{typeLabel}</span>}
            {hardware.vidPid && <span className="rounded bg-bg-subtle px-1 font-mono">VID {hardware.vidPid.split(':')[0]} · PID {hardware.vidPid.split(':')[1]}</span>}
          </span>
          {(hardware.manufacturer != null || hardware.serialNumber != null) && <span className="block break-all text-[10px] text-text-muted">{[hardware.manufacturer, hardware.serialNumber && `SN ${hardware.serialNumber}`].filter(Boolean).join(' · ')}</span>}
        </span>
        <Plus size={14} className="mt-1 shrink-0 text-text-muted group-hover:text-accent" />
      </button>
      <div className="flex items-center gap-2 border-t border-border px-2.5 py-1.5 text-[10px] text-text-muted">
        <span>{t(lang, 'devicePanelConnectVia')}</span>
        {device.options.length > 1 ? <select aria-label={`${t(lang, 'devicePanelConnectVia')} ${endpoint.displayName}`} value={option.card.key}
          disabled={disabled} onChange={(event) => setSelected(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-bg-input px-1 py-1 text-[11px] text-text-primary focus:outline-accent">
          {device.options.map(({ card }) => <option key={card.key} value={card.key}>{adapterLabel(card)}</option>)}
        </select> : <span className="truncate text-text-secondary">{adapterLabel(option.card)}</span>}
      </div>
    </div>
  );
}

import { Loader2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { t } from '../../i18n';
import type { DiscoveredEndpoint } from '../../types';
import { endpointHardwareDetails, endpointSubtitle, isEndpointApplied } from './discoveredEndpoints';

interface DiscoveredEndpointListProps {
  endpoints: DiscoveredEndpoint[];
  payload: Record<string, unknown>;
  pending: boolean;
  disabled: boolean;
  onRefresh: () => void;
  onSelect: (endpoint: DiscoveredEndpoint) => void;
}

export function DiscoveredEndpointList({
  endpoints,
  payload,
  pending,
  disabled,
  onRefresh,
  onSelect,
}: DiscoveredEndpointListProps) {
  const lang = useAppStore((state) => state.lang);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-secondary">{t(lang, 'capabilityDiscoveredEndpoint')}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={onRefresh}
          title={t(lang, 'refresh')}
          aria-label={t(lang, 'refresh')}
          className="p-1 rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-disabled"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>
      {endpoints.length === 0 ? (
        <div role="status" className="rounded border border-dashed border-border px-2 py-3 text-center text-[11px] text-text-muted">
          {t(lang, pending ? 'capabilityDiscovering' : 'capabilityNoEndpointsDiscovered')}
        </div>
      ) : (
        <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
          {endpoints.map((endpoint) => (
            <DiscoveredEndpointCard
              key={endpoint.discoveryId}
              endpoint={endpoint}
              applied={isEndpointApplied(endpoint, payload)}
              disabled={disabled}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DiscoveredEndpointCard({
  endpoint,
  applied,
  disabled,
  onSelect,
}: {
  endpoint: DiscoveredEndpoint;
  applied: boolean;
  disabled: boolean;
  onSelect: (endpoint: DiscoveredEndpoint) => void;
}) {
  const subtitle = endpointSubtitle(endpoint);
  const hardware = endpointHardwareDetails(endpoint);
  const hasHardware = hardware.vidPid != null || hardware.serialNumber != null || hardware.manufacturer != null;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={applied}
      onClick={() => onSelect(endpoint)}
      className={`flex flex-col gap-0.5 rounded border px-2 py-1.5 text-left transition-colors disabled:opacity-disabled ${
        applied
          ? 'border-accent bg-bg-active'
          : 'border-border bg-bg-inset hover:bg-bg-hover'
      }`}
    >
      <span className="truncate text-xs text-text-primary">{endpoint.displayName}</span>
      {subtitle && <span className="truncate text-[10px] text-text-muted">{subtitle}</span>}
      {hasHardware && (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pt-0.5 text-[10px] text-text-secondary">
          {hardware.manufacturer && <span className="truncate">{hardware.manufacturer}</span>}
          {hardware.vidPid && (
            <span className="rounded bg-bg-subtle px-1 font-mono text-text-muted">{hardware.vidPid}</span>
          )}
          {hardware.serialNumber && (
            <span className="truncate font-mono text-text-muted">SN {hardware.serialNumber}</span>
          )}
        </span>
      )}
    </button>
  );
}

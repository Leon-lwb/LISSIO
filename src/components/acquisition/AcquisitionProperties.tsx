import { useEffect, useState } from 'react';
import type { Node } from '@xyflow/react';
import { Plug, PlugZap } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { t } from '../../i18n';
import { CAPABILITY_CONTRACT_VERSION } from '../../types';
import { api } from '../../lib/tauri/tauri';
import { formatError } from '../../lib/tauri/notifications';
import { loadAdapterCapabilities } from '../../lib/acquisition/capabilityCatalog';
import { buildDeviceCards, type DeviceCardModel } from '../../lib/acquisition/deviceCardModel';
import { updateAcquisitionNode, type AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';
import { refreshEndpointSnapshots, useEndpointSnapshot } from '../../lib/acquisition/useEndpointSnapshot';
import { SchemaFields } from './SchemaFields';

export function AcquisitionProperties({ node }: { node: Node }) {
  const lang = useAppStore((s) => s.lang);
  const { spec, card: initialCard } = node.data as AcquisitionNodeData;
  const [card, setCard] = useState<DeviceCardModel | undefined>(initialCard);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const snapshot = useEndpointSnapshot(node.id);
  const hasSession = snapshot != null && snapshot.state.state !== 'closed';

  useEffect(() => {
    let active = true;
    void loadAdapterCapabilities().then((adapters) => {
      const adapter = adapters.find((item) => item.adapterId === spec.driver.driverId);
      const nextCard = adapter && buildDeviceCards([adapter]).find((item) =>
        item.endpoint.id === spec.capabilityEndpointId || (!spec.capabilityEndpointId && adapter.endpoints.length === 1));
      if (active) setCard(nextCard);
    }).catch((cause: unknown) => { if (active) setError(formatError(cause)); });
    return () => { active = false; };
  }, [spec.driver.driverId, spec.capabilityEndpointId]);

  const connect = async () => {
    if (!card) return;
    setPending(true);
    setError('');
    try {
      await useAppStore.getState().connectNode(node.id);
      await refreshEndpointSnapshots();
    } catch (cause) { setError(formatError(cause)); }
    finally { setPending(false); }
  };

  const disconnect = async () => {
    setPending(true);
    setError('');
    try { await api.closeAcquisitionEndpoint(node.id); await refreshEndpointSnapshots(); }
    catch (cause) { setError(formatError(cause)); }
    finally { setPending(false); }
  };

  if (!card) return <div className="text-xs text-text-secondary" role="status">{error || t(lang, 'capabilityUnavailable')}</div>;
  const disabled = pending || hasSession;
  return (
    <div className="flex flex-col gap-3">
      <SchemaFields
        schema={card.endpoint.configuration.jsonSchema}
        uiHints={card.endpoint.configuration.uiHints}
        value={spec.driver.payload} disabled={disabled}
        onChange={(payload) => updateAcquisitionNode(node.id, { ...spec, driver: { ...spec.driver, payload: payload as Record<string, unknown> } })}
      />
      <div className="mt-3 pt-2 border-t border-border">
        {card.adapter.contractVersion !== CAPABILITY_CONTRACT_VERSION && <div className="mb-2 text-xs text-text-secondary">{t(lang, 'capabilityVersionFallback')}</div>}
        <button
          type="button"
          disabled={pending || (!hasSession && (card.endpoint.status.state === 'unavailable' || card.adapter.contractVersion !== CAPABILITY_CONTRACT_VERSION))}
          onClick={() => { void (hasSession ? disconnect() : connect()); }}
          className={`w-full px-3 h-8 border-none rounded text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50 ${hasSession ? 'bg-bg-danger text-text-bright hover:bg-bg-danger-hover' : 'bg-bg-button text-text-inverse hover:bg-bg-button-hover'}`}
        >
          {hasSession ? <PlugZap size={14} /> : <Plug size={14} />}
          {t(lang, pending ? 'connecting' : hasSession ? 'disconnect' : 'connect')}
        </button>
        {error && <div className="mt-1.5 text-xs text-red break-all" role="alert">{error}</div>}
      </div>
    </div>
  );
}

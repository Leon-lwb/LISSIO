import { translate } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import type { SimulationConfig } from '../../types';
import { DraftNumberInput } from '../ui/fields';

/** 设备树中的虚拟数据源配置。 */
export function SimulationNodeFields({ config, onChange }: {
  config: SimulationConfig;
  onChange: (patch: Partial<SimulationConfig>) => void;
}) {
  const lang = useAppStore(s => s.lang);
  const formats = ['JustFloat', 'FireWater', 'RawData'];
  return <div className="flex flex-col gap-3 text-xs">
    <p className="text-text-secondary leading-relaxed">{translate('deviceTreeSimulationHint', lang)}</p>
    <label>{translate('deviceTreeSignal', lang)}
      <select className="form-select mt-1" value={config.signal.waveform}
        onChange={e => onChange({ signal: { ...config.signal, waveform: e.target.value as SimulationConfig['signal']['waveform'] } })}>
        {['sine', 'square', 'triangle', 'sawtooth', 'random', 'dc'].map(value => <option key={value}>{value}</option>)}
      </select>
    </label>
    {(['frequency', 'amplitude', 'offset'] as const).map(key => <label key={key}>
      {translate({ frequency: 'deviceTreeFrequency', amplitude: 'deviceTreeAmplitude', offset: 'deviceTreeOffset' }[key], lang)}
      <DraftNumberInput className="form-input mt-1" step="any" value={config.signal[key]}
        min={key === 'frequency' ? 0 : undefined}
        onCommit={value => onChange({ signal: { ...config.signal, [key]: value } })} />
    </label>)}
    <label>{translate('deviceTreeSampleRate', lang)}<DraftNumberInput className="form-input mt-1" min={1} max={5000000}
      value={config.sampleRate} onCommit={sampleRate => onChange({ sampleRate })} /></label>
    <label>{translate('channels', lang)}<DraftNumberInput className="form-input mt-1" integer min={1} max={256}
      value={config.channels} onCommit={channels => onChange({ channels })} /></label>
    <label>{translate('deviceTreeSeed', lang)}<DraftNumberInput className="form-input mt-1" integer min={0} max={4294967295}
      value={config.seed} onCommit={seed => onChange({ seed })} /></label>
    <label>{translate('deviceTreeEncoding', lang)}
      <select className="form-select mt-1" value={(config.encoding as { protocol?: { kind?: string } } | null)?.protocol?.kind ?? ''}
        onChange={e => onChange({ referenceNodeId: null, encoding: e.target.value
          ? { protocol: e.target.value === 'RawData' ? { kind: 'RawData' } : { kind: e.target.value, channels: config.channels }, schema: null }
          : null })}>
        <option value="">{translate('deviceTreeAutoEncoding', lang)}</option>
        {formats.map(format => <option key={format}>{format}</option>)}
      </select>
    </label>
  </div>;
}

import { memo } from 'react';
import type { Node } from '@xyflow/react';
import { useAppStore } from '../../store/appStore';
import { t } from '../../i18n';
import { ProtocolConfigForm } from '../panels/protocol/ProtocolConfigForm';
import { isRawDataPreset } from '../../lib/utils/protocolSchema';
import type { ProtocolNodeData } from '../../store/appStoreHelpers';

/// Protocol 节点属性 — 协议配置 + 可选协议转换 (convert_to)
export const ProtocolProperties = memo(function ProtocolProperties({ node }: { node: Node }) {
  const lang = useAppStore((s) => s.lang);
  const setProtocolNodeConfig = useAppStore((s) => s.setProtocolNodeConfig);
  const setProtocolNodeConvertTo = useAppStore((s) => s.setProtocolNodeConvertTo);
  const setProtocolNodeSchema = useAppStore((s) => s.setProtocolNodeSchema);
  const detectedChannels = useAppStore((s) => s.detectedChannels[node.id] ?? null);

  const data = node.data as unknown as ProtocolNodeData;
  const convertTo = data.convertTo ?? null;

  const convertKinds: { value: string; label: string }[] = [
    { value: '', label: t(lang, 'convertNone') },
    { value: 'JustFloat', label: t(lang, 'justfloat') },
    { value: 'FireWater', label: t(lang, 'firewater') },
    { value: 'RawData', label: t(lang, 'rawdata') },
  ];

  const onConvertKindChange = (kind: string) => {
    if (!kind) {
      setProtocolNodeConvertTo(node.id, null);
      return;
    }
    const prev = convertTo;
    if (kind === 'JustFloat' || kind === 'FireWater') {
      const channels =
        prev && (prev.kind === 'JustFloat' || prev.kind === 'FireWater') ? prev.channels : null;
      setProtocolNodeConvertTo(node.id, { kind, channels });
    } else {
      setProtocolNodeConvertTo(node.id, { kind: 'RawData' });
    }
  };

  return (
    <div>
      <ProtocolConfigForm
        value={data.config}
        onChange={(c) => void setProtocolNodeConfig(node.id, c)}
        lang={lang}
        detectedChannels={detectedChannels}
        schema={data.schema}
        onSchemaChange={(s) => setProtocolNodeSchema(node.id, s)}
      />

      {/* 协议转换 (convert_to) — 默认无转换 */}
      <div className="mt-3 pt-2 border-t border-border">
        <label className="block text-xs text-text-secondary mb-1">{t(lang, 'convertTo')}</label>
        <select
          value={convertTo?.kind ?? ''}
          onChange={(e) => onConvertKindChange(e.target.value)}
          className="form-select"
        >
          {convertKinds.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
        {/* RawData 预设不产帧: 提示 convert_to 不生效、原文透传 (后端语义) */}
        {isRawDataPreset(data) && (
          <div className="mt-1 text-[10px] text-text-secondary opacity-secondary break-all">
            {t(lang, 'convertRawDataHint')}
          </div>
        )}
        {convertTo && (convertTo.kind === 'JustFloat' || convertTo.kind === 'FireWater') && (
          <div className="mt-2">
            <ProtocolConfigForm
              value={convertTo}
              onChange={(c) => setProtocolNodeConvertTo(node.id, c)}
              lang={lang}
              nameSuffix="-convert"
            />
          </div>
        )}
      </div>
    </div>
  );
});

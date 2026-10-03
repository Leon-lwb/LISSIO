import { AlertTriangle } from 'lucide-react';
import type {
  DecoderBlock,
  ChecksumType,
  DecoderChecksumPosition,
  DecoderChecksumCover,
  FieldType,
} from '../../../types';
import type { useAppStore } from '../../../store/appStore';
import { t } from '../../../i18n';
import { DraftInput, DraftNumberInput, DraftTextarea, parseDraftNumber } from '../../ui/fields';
import {
  CHECKSUM_OPTIONS,
  CHECKSUM_POSITION_OPTIONS,
  CHECKSUM_COVER_OPTIONS,
  FIELD_TYPE_OPTIONS,
} from './frameDecoderShared';

export interface BlockEditorProps {
  block: DecoderBlock;
  updateBlock: (id: string, changes: Partial<DecoderBlock>) => void;
  lang: ReturnType<typeof useAppStore.getState>['lang'];
}

export function BlockEditor({ block, updateBlock, lang }: BlockEditorProps) {
  const inputClass = "w-full px-1.5 py-0.5 bg-bg-input text-text-primary border border-border rounded-sm text-xs font-mono focus:outline-none focus:border-accent";
  const labelClass = "text-[10px] text-text-secondary";
  const selectClass = "w-full px-1.5 py-0.5 bg-bg-input text-text-primary border border-border rounded-sm text-xs focus:outline-none focus:border-accent";
  // 扩展块 (csv/asciiField/samples) 在 Rust 端无 id, TS 上 id 可选 — 统一回退空串
  const bid = block.id ?? '';

  return (
    <>
      {/* 通用: label */}
      <div className="field-grid field-grid--compact">
        <label className={labelClass}>{t(lang, 'cmdBlockLabel')}</label>
        <DraftInput
          type="text"
          value={block.label ?? ''}
          onCommit={(label) => updateBlock(bid, { label })}
          className={inputClass}
          placeholder={t(lang, 'cmdBlockLabelPlaceholder')}
        />
      </div>

      {/* header / tail: HEX */}
      {(block.type === 'header' || block.type === 'tail') && (
        <div className="field-grid field-grid--compact">
          <label htmlFor={`decoder-block-${bid}-hex`} className={labelClass}>HEX</label>
          <DraftInput
            id={`decoder-block-${bid}-hex`}
            type="text"
            value={block.hex ?? ''}
            onCommit={(hex) => updateBlock(bid, { hex })}
            className={inputClass}
            placeholder="AA BB"
            spellCheck={false}
          />
        </div>
      )}

      {/* length / id / field: fieldType + portName */}
      {(block.type === 'length' || block.type === 'id' || block.type === 'field') && (
        <>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'cmdBlockType')}</label>
            <select
              value={block.fieldType ?? 'uint8'}
              onChange={(e) => updateBlock(bid, { fieldType: e.target.value as FieldType })}
              className={selectClass}
            >
              {FIELD_TYPE_OPTIONS.map((ft) => (
                <option key={ft} value={ft}>{ft}</option>
              ))}
            </select>
          </div>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'cmdBlockPortName')}</label>
            <DraftInput
              type="text"
              value={block.portName ?? ''}
              onCommit={(portName) => updateBlock(bid, { portName })}
              className={inputClass}
              placeholder={block.type === 'length' ? 'length' : block.type === 'id' ? 'id_value' : 'field_1'}
              spellCheck={false}
            />
          </div>
        </>
      )}

      {/* length: unit */}
      {block.type === 'length' && (
        <div className="field-grid field-grid--compact">
          <label className={labelClass}>{t(lang, 'fdLengthUnit')}</label>
          <select
            value={block.unit ?? 'bytes'}
            onChange={(e) => updateBlock(bid, { unit: e.target.value as 'bytes' | 'fields' })}
            className={selectClass}
          >
            <option value="bytes">{t(lang, 'fdLengthUnitBytes')}</option>
            <option value="fields">{t(lang, 'fdLengthUnitFields')}</option>
          </select>
        </div>
      )}

      {/* field: lengthRef (仅 bytes 类型有意义) */}
      {block.type === 'field' && (
        <div className="field-grid field-grid--compact">
          <label className={labelClass}>{t(lang, 'fdLengthRef')}</label>
          <DraftInput
            type="text"
            value={block.lengthRef ?? ''}
            onCommit={(draft) => updateBlock(bid, { lengthRef: draft || null })}
            className={inputClass}
            placeholder={t(lang, 'fdLengthRefPlaceholder')}
            spellCheck={false}
          />
        </div>
      )}

      {/* bitfield: byteOffset / bitOffset / bitLength / isSigned / portName */}
      {block.type === 'bitfield' && (
        <>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'fdByteOffset')}</label>
            <DraftNumberInput
              min={0}
              integer
              value={block.byteOffset ?? 0}
              onCommit={(byteOffset) => updateBlock(bid, { byteOffset })}
              className={inputClass}
            />
          </div>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'fdBitOffset')}</label>
            <DraftNumberInput
              min={0}
              max={7}
              integer
              value={block.bitOffset ?? 0}
              onCommit={(bitOffset) => updateBlock(bid, { bitOffset })}
              className={inputClass}
            />
          </div>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'fdBitLength')}</label>
            <DraftNumberInput
              min={1}
              max={32}
              integer
              value={block.bitLength ?? 4}
              onCommit={(bitLength) => updateBlock(bid, { bitLength })}
              className={inputClass}
            />
          </div>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'fdSigned')}</label>
            <button
              className={`px-2 py-0.5 text-xs rounded-sm border ${block.isSigned ? 'bg-bg-button text-text-inverse border-bg-button' : 'bg-bg-input text-text-secondary border-border'}`}
              onClick={() => updateBlock(bid, { isSigned: !block.isSigned })}
            >
              {block.isSigned ? t(lang, 'fdSignedYes') : t(lang, 'fdSignedNo')}
            </button>
          </div>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'cmdBlockPortName')}</label>
            <DraftInput
              type="text"
              value={block.portName ?? ''}
              onCommit={(portName) => updateBlock(bid, { portName })}
              className={inputClass}
              placeholder="bits_1"
              spellCheck={false}
            />
          </div>
        </>
      )}

      {/* checksum: algorithm / cover / position / customScript */}
      {block.type === 'checksum' && (
        <>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'cmdChecksum')}</label>
            <select
              value={block.algorithm ?? 'sum8'}
              onChange={(e) => updateBlock(bid, { algorithm: e.target.value as ChecksumType })}
              className={selectClass}
            >
              {CHECKSUM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(lang, opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'fdChecksumCover')}</label>
            <select
              value={block.cover ?? 'all_prior'}
              onChange={(e) => updateBlock(bid, { cover: e.target.value as DecoderChecksumCover })}
              className={selectClass}
            >
              {CHECKSUM_COVER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(lang, opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
          {block.cover === 'range' && (
            <>
              <div className="field-grid field-grid--compact">
                <label className={labelClass}>{t(lang, 'fdCoverStart')}</label>
                <DraftNumberInput
                  min={0}
                  integer
                  value={block.coverStart ?? 0}
                  onCommit={(coverStart) => updateBlock(bid, { coverStart })}
                  className={inputClass}
                />
              </div>
              <div className="field-grid field-grid--compact">
                <label className={labelClass}>{t(lang, 'fdCoverEnd')}</label>
                <DraftNumberInput
                  min={0}
                  integer
                  value={block.coverEnd ?? 0}
                  onCommit={(coverEnd) => updateBlock(bid, { coverEnd })}
                  className={inputClass}
                />
              </div>
            </>
          )}
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'cmdChecksumPosition')}</label>
            <select
              value={block.position ?? 'append'}
              onChange={(e) => updateBlock(bid, { position: e.target.value as DecoderChecksumPosition })}
              className={selectClass}
            >
              {CHECKSUM_POSITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(lang, opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
          {block.algorithm === 'custom' && (
            <div className="flex flex-col gap-1">
              <label className={labelClass}>{t(lang, 'cmdCustomScript')}</label>
              <DraftTextarea
                className="w-full font-mono text-xs bg-bg-input text-text-primary border border-border rounded-sm px-1.5 py-1 outline-none focus:border-accent resize-y min-h-[60px] leading-relaxed"
                value={block.customScript ?? ''}
                onCommit={(customScript) => updateBlock(bid, { customScript })}
                spellCheck={false}
                rows={4}
                placeholder={'// bytes: 输入字节数组\n// 返回: 校验字节数组\nlet s = 0;\nfor (const b of bytes) s = (s + b) & 0xff;\nreturn [s];'}
              />
              <div className="flex items-center gap-1 px-1.5 py-0.5 bg-yellow/10 border border-yellow/30 text-yellow text-[10px] rounded-sm">
                <AlertTriangle size={10} />
                <span>{t(lang, 'cmdCustomWarn')}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* csv: 分隔符 + 端口列表 (逗号分隔端口名) */}
      {block.type === 'csv' && (
        <>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'fdCsvSeparator')}</label>
            <DraftInput
              type="text"
              value={block.separator}
              onCommit={(separator) => updateBlock(bid, { separator })}
              className={inputClass}
              placeholder=","
              spellCheck={false}
            />
          </div>
          <div className="field-grid field-grid--compact">
            <label className={labelClass}>{t(lang, 'fdCsvPorts')}</label>
            <DraftInput
              type="text"
              value={block.ports.join(',')}
              onCommit={(draft) => updateBlock(bid, { ports: draft.split(',').map((p) => p.trim()).filter(Boolean) })}
              className={inputClass}
              placeholder="ch0,ch1,ch2"
              spellCheck={false}
            />
          </div>
        </>
      )}

      {/* matchId (id 块与扩展块 csv/asciiField/samples 不可设置) */}
      {block.type !== 'id' && block.type !== 'csv' && block.type !== 'asciiField' && block.type !== 'samples' && (
        <div className="field-grid field-grid--compact">
          <label className={labelClass}>{t(lang, 'fdMatchId')}</label>
          <DraftInput
            type="number"
            value={block.matchId != null ? String(block.matchId) : ''}
            validate={(draft) => draft.trim() === '' || parseDraftNumber(draft, { integer: true }) != null}
            onCommit={(draft) => updateBlock(bid, { matchId: parseDraftNumber(draft, { integer: true }) })}
            className={inputClass}
            placeholder={t(lang, 'fdMatchIdPlaceholder')}
          />
        </div>
      )}
    </>
  );
}

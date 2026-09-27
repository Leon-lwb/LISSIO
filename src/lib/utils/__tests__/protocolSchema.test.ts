import { describe, expect, it } from 'vitest';
import { isRawDataPreset, schemaPortNames } from '../protocolSchema';
import type { DecoderBlock } from '../../../types';

// 预设工厂 (justfloat/firewater/... schemaFromProtocolConfig/protocolPortNames/
// getEffectiveChannels) 已删除 — schema 的单一来源是目录 prepare (后端
// schema_types::preset), 端口的单一来源是 describe_node_documents。
// 前端仅保留对持久化 schema 数据的纯派生/判读 helper。

describe('schemaPortNames (custom 端口派生, 与 Rust port_names 对齐)', () => {
  it('field/bitfield/csv.ports/asciiField 按块序去重; header/length/id/checksum/tail/samples 不占端口', () => {
    // 与 Rust test_port_names_derivation 相同的块序列
    const decode: DecoderBlock[] = [
      { id: 'h', type: 'header', hex: 'AA' },
      { id: 'f0', type: 'field', fieldType: 'uint8', portName: 'v0' },
      { id: 'b0', type: 'bitfield', byteOffset: 1, bitOffset: 0, bitLength: 4, isSigned: false, portName: 'flags' },
      { type: 'csv', separator: ',', ports: ['c0', 'c1'] },
      { type: 'asciiField', portName: 'hex_id', base: 'hex', digits: 2 },
    ];
    expect(schemaPortNames(decode)).toEqual(['v0', 'flags', 'c0', 'c1', 'hex_id']);
  });

  it('重复端口名去重且保持首次出现顺序', () => {
    const decode: DecoderBlock[] = [
      { id: 'f0', type: 'field', fieldType: 'uint8', portName: 'a' },
      { id: 'f1', type: 'field', fieldType: 'uint8', portName: 'b' },
      { id: 'f2', type: 'field', fieldType: 'uint8', portName: 'a' },
      { type: 'csv', separator: ',', ports: ['b', 'c'] },
    ];
    expect(schemaPortNames(decode)).toEqual(['a', 'b', 'c']);
  });
});

describe('isRawDataPreset (持久化数据判读)', () => {
  it('RawData 预设 → true; custom 块编辑后 → false', () => {
    expect(isRawDataPreset({ config: { kind: 'RawData' }, schema: { preset: 'rawData', presetConfig: { kind: 'RawData' }, decode: [] } })).toBe(true);
    expect(isRawDataPreset({
      config: { kind: 'RawData' },
      schema: {
        preset: 'custom', presetConfig: null,
        decode: [{ id: 'f0', type: 'field', fieldType: 'uint8', portName: 'v0' }],
      },
    })).toBe(false);
    expect(isRawDataPreset({ config: { kind: 'JustFloat', channels: 2 } })).toBe(false);
  });
});

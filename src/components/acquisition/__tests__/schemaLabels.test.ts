import { describe, expect, it } from 'vitest';
import { schemaEnumLabel, schemaEnumLabelKey, schemaFieldLabel, schemaFieldLabelKey } from '../schemaLabels';

describe('schemaFieldLabelKey', () => {
  it('maps snake_case serial keys', () => {
    expect(schemaFieldLabelKey('baud_rate')).toBe('schemaFieldBaudRate');
    expect(schemaFieldLabelKey('data_bits')).toBe('schemaFieldDataBits');
    expect(schemaFieldLabelKey('stop_bits')).toBe('schemaFieldStopBits');
    expect(schemaFieldLabelKey('flow_control')).toBe('schemaFieldFlowControl');
    expect(schemaFieldLabelKey('port_name')).toBe('schemaFieldPortName');
  });

  it('maps camelCase modbus keys to the same labels', () => {
    expect(schemaFieldLabelKey('baudRate')).toBe('schemaFieldBaudRate');
    expect(schemaFieldLabelKey('dataBits')).toBe('schemaFieldDataBits');
    expect(schemaFieldLabelKey('stopBits')).toBe('schemaFieldStopBits');
    expect(schemaFieldLabelKey('flowControl')).toBe('schemaFieldFlowControl');
    expect(schemaFieldLabelKey('unitId')).toBe('schemaFieldUnitId');
  });

  it('maps unit_id and slave_id aliases', () => {
    expect(schemaFieldLabelKey('unit_id')).toBe('schemaFieldUnitId');
    expect(schemaFieldLabelKey('slave_id')).toBe('schemaFieldUnitId');
  });

  it('returns undefined for unknown keys', () => {
    expect(schemaFieldLabelKey('mystery_field')).toBeUndefined();
  });
});

describe('schemaFieldLabel', () => {
  it('translates known keys per language', () => {
    expect(schemaFieldLabel('zh', 'baud_rate')).toBe('波特率');
    expect(schemaFieldLabel('en', 'baudRate')).toBe('Baud rate');
    expect(schemaFieldLabel('zh', 'parity')).toBe('校验位');
  });

  it('returns undefined for unmapped keys so callers can fall back', () => {
    expect(schemaFieldLabel('zh', 'mystery_field')).toBeUndefined();
  });
});

describe('schemaEnumLabelKey', () => {
  it('maps parity and flow control enum values', () => {
    expect(schemaEnumLabelKey('none')).toBe('schemaEnumNone');
    expect(schemaEnumLabelKey('odd')).toBe('schemaEnumOdd');
    expect(schemaEnumLabelKey('even')).toBe('schemaEnumEven');
    expect(schemaEnumLabelKey('software')).toBe('schemaEnumSoftware');
    expect(schemaEnumLabelKey('hardware')).toBe('schemaEnumHardware');
  });

  it('maps modbus area enum values', () => {
    expect(schemaEnumLabelKey('coils')).toBe('schemaEnumCoils');
    expect(schemaEnumLabelKey('holdingRegisters')).toBe('schemaEnumHoldingRegisters');
  });

  it('returns undefined for unmapped values', () => {
    expect(schemaEnumLabelKey('Bps500k')).toBeUndefined();
  });
});

describe('schemaEnumLabel', () => {
  it('translates enum values per language', () => {
    expect(schemaEnumLabel('zh', 'odd')).toBe('奇校验');
    expect(schemaEnumLabel('en', 'hardware')).toBe('Hardware');
    expect(schemaEnumLabel('zh', 'none')).toBe('无');
  });

  it('returns undefined for unmapped values', () => {
    expect(schemaEnumLabel('zh', 'Bps500k')).toBeUndefined();
  });
});

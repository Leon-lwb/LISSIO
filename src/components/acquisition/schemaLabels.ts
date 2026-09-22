import { t, type Lang } from '../../i18n';
import type { CanBitrate } from '../../types';

const FIELD_KEYS: Record<string, string> = {
  port_name: 'schemaFieldPortName',
  portName: 'schemaFieldPortName',
  baud_rate: 'schemaFieldBaudRate',
  baudRate: 'schemaFieldBaudRate',
  data_bits: 'schemaFieldDataBits',
  dataBits: 'schemaFieldDataBits',
  stop_bits: 'schemaFieldStopBits',
  stopBits: 'schemaFieldStopBits',
  parity: 'schemaFieldParity',
  flow_control: 'schemaFieldFlowControl',
  flowControl: 'schemaFieldFlowControl',
  host: 'schemaFieldHost',
  port: 'schemaFieldPort',
  path: 'schemaFieldPath',
  address: 'schemaFieldAddress',
  slave_id: 'schemaFieldUnitId',
  unit_id: 'schemaFieldUnitId',
  unitId: 'schemaFieldUnitId',
  local_addr: 'schemaFieldLocalAddr',
  remote_addr: 'schemaFieldRemoteAddr',
  local_port: 'schemaFieldLocalPort',
  remote_port: 'schemaFieldRemotePort',
  listen_addr: 'schemaFieldListenAddr',
  listen_port: 'schemaFieldListenPort',
  channels: 'schemaFieldChannels',
  sample_rate: 'schemaFieldSampleRate',
  signal: 'schemaFieldSignal',
  can_bitrate: 'schemaFieldCanBitrate',
  bus: 'schemaFieldBus',
  channel: 'schemaFieldChannel',
  timeoutMs: 'schemaFieldTimeoutMs',
  reconnect: 'schemaFieldReconnect',
  maxAttempts: 'schemaFieldMaxAttempts',
  initialDelayMs: 'schemaFieldInitialDelayMs',
  maxDelayMs: 'schemaFieldMaxDelayMs',
  points: 'schemaFieldPoints',
  id: 'schemaFieldId',
  area: 'schemaFieldArea',
  dataType: 'schemaFieldDataType',
  byteOrder: 'schemaFieldByteOrder',
  wordOrder: 'schemaFieldWordOrder',
  plcType: 'schemaFieldPlcType',
  rack: 'schemaFieldRack',
  slot: 'schemaFieldSlot',
  dbNumber: 'schemaFieldDbNumber',
  byteOffset: 'schemaFieldByteOffset',
  bit: 'schemaFieldBit',
  scale: 'schemaFieldScale',
  offset: 'schemaFieldOffset',
  pollPeriodMs: 'schemaFieldPollPeriodMs',
};

/// CAN 波特率枚举值 → i18n 键 — Record 键穷举, 新增变体漏配标签时编译报错
const BITRATE_ENUM_KEYS: Record<CanBitrate, string> = {
  Bps10k: 'schemaEnumBps10k',
  Bps20k: 'schemaEnumBps20k',
  Bps50k: 'schemaEnumBps50k',
  Bps100k: 'schemaEnumBps100k',
  Bps125k: 'schemaEnumBps125k',
  Bps250k: 'schemaEnumBps250k',
  Bps500k: 'schemaEnumBps500k',
  Bps800k: 'schemaEnumBps800k',
  Bps1m: 'schemaEnumBps1m',
};

const ENUM_KEYS: Record<string, string> = {
  none: 'schemaEnumNone',
  odd: 'schemaEnumOdd',
  even: 'schemaEnumEven',
  one: 'schemaEnumOne',
  two: 'schemaEnumTwo',
  software: 'schemaEnumSoftware',
  hardware: 'schemaEnumHardware',
  seven: 'schemaEnumSeven',
  eight: 'schemaEnumEight',
  big: 'schemaEnumBig',
  little: 'schemaEnumLittle',
  coils: 'schemaEnumCoils',
  discreteInputs: 'schemaEnumDiscreteInputs',
  inputRegisters: 'schemaEnumInputRegisters',
  holdingRegisters: 'schemaEnumHoldingRegisters',
  inputs: 'schemaEnumInputs',
  outputs: 'schemaEnumOutputs',
  markers: 'schemaEnumMarkers',
  db: 'schemaEnumDb',
  ...BITRATE_ENUM_KEYS,
};

export function schemaFieldLabelKey(name: string): string | undefined {
  return FIELD_KEYS[name];
}

export function schemaEnumLabelKey(value: string): string | undefined {
  return ENUM_KEYS[value];
}

export function schemaFieldLabel(lang: Lang, name: string): string | undefined {
  const key = schemaFieldLabelKey(name);
  return key ? t(lang, key) : undefined;
}

export function schemaEnumLabel(lang: Lang, value: string): string | undefined {
  const key = schemaEnumLabelKey(value);
  return key ? t(lang, key) : undefined;
}

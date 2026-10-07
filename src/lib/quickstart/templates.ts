//! 快速开始模板 — 模板只声明 modelId / 变体 / 显式场景参数与连线布局;
//! 节点文档由后端 prepare 批量产出 (默认值/归一化的唯一来源)。
//!
//! 应用时:
//!   - 替换: 清空工作区后按分区应用 (不含设置)
//!   - 合并: 作为新控件标签页追加 (见 applyTemplate.ts 的 ID 重映射)
//!
//! 内置模板: 数学 / 滤波器 / 频谱分析 / CAN / 串口 / 自定义协议 / 文本协议 / 综合演示。
//! 快照装配 (设备树/协议子节点/Dock/固定外壳 Tab) 见 snapshot.ts。

import { prepareProtocolDocument } from '../models/createFromCatalog';
import { rawDataPortId } from '../utils/nodeDef';
import type { AppSnapshot } from '../tauri/appExport';
import type { ProtocolSchema, SlcanConfig } from '../../types';
import {
  PROTOCOL_ID, TAB, TRANSPORT_ID,
  WIDGET_COL1_X, WIDGET_COL2_X, WIDGET_COL3_X,
  buildSnapshot, prepareWidgetSpecs, simulatedSerial,
} from './snapshot';

// ==================== 模板定义 ====================

export interface QuickStartTemplate {
  id: string;
  nameKey: string;
  descKey: string;
  build: () => Promise<AppSnapshot>;
}

async function mathTemplate(): Promise<AppSnapshot> {
  const [mSin, ndSin, mAdd, ndAdd] = await prepareWidgetSpecs([
    { modelId: 'widget:Math', variantId: 'sin', nodeId: 'm-sin', label: 'sin', position: { x: WIDGET_COL1_X, y: 80 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-sin', label: 'sin(ch0)', position: { x: WIDGET_COL2_X, y: 80 } },
    { modelId: 'widget:Math', variantId: 'add', nodeId: 'm-add', label: 'sum', position: { x: WIDGET_COL1_X, y: 260 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-add', label: 'ch0+ch1', position: { x: WIDGET_COL2_X, y: 260 } },
  ]);
  return buildSnapshot({
    name: 'Math',
    device: simulatedSerial(4, 1000),
    protocol: await prepareProtocolDocument({ kind: 'JustFloat', channels: 4 }, TAB),
    convertTo: { kind: 'JustFloat', channels: 4 },
    widgetDocs: [mSin, ndSin, mAdd, ndAdd],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'm-sin', targetHandle: 'in0' },
      { id: 'e2', source: 'm-sin', sourceHandle: 'result', target: 'nd-sin', targetHandle: 'value' },
      { id: 'e3', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'm-add', targetHandle: 'in0' },
      { id: 'e4', source: PROTOCOL_ID, sourceHandle: 'ch1', target: 'm-add', targetHandle: 'in1' },
      { id: 'e5', source: 'm-add', sourceHandle: 'result', target: 'nd-add', targetHandle: 'value' },
    ],
  });
}

async function filterTemplate(): Promise<AppSnapshot> {
  const [fLp, ndLp, wf] = await prepareWidgetSpecs([
    { modelId: 'widget:Filter', variantId: 'Lowpass', nodeId: 'f-lp', label: 'Lowpass',
      position: { x: WIDGET_COL1_X, y: 80 }, configPatch: { cutoff: 100, sampleRate: 1000 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-lp', label: 'filtered', position: { x: WIDGET_COL2_X, y: 80 } },
    { modelId: 'widget:Waveform', nodeId: 'wf-filter', label: 'Filtered', position: { x: WIDGET_COL1_X, y: 260 },
      configPatch: { channels: 4, dynamicSeries: true } },
  ]);
  return buildSnapshot({
    name: 'Filter',
    device: simulatedSerial(4, 1000),
    protocol: await prepareProtocolDocument({ kind: 'JustFloat', channels: 4 }, TAB),
    convertTo: { kind: 'JustFloat', channels: 4 },
    widgetDocs: [fLp, ndLp, wf],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'f-lp', targetHandle: 'in0' },
      { id: 'e2', source: 'f-lp', sourceHandle: 'result', target: 'nd-lp', targetHandle: 'value' },
      { id: 'e3', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'wf-filter', targetHandle: 'CH0' },
      { id: 'e4', source: 'f-lp', sourceHandle: 'result', target: 'wf-filter', targetHandle: 'CH1' },
    ],
  });
}

async function canTemplate(): Promise<AppSnapshot> {
  return buildSnapshot({
    name: 'CAN',
    device: { name: 'Slcan', driver: 'slcan', schemaVersion: 1,
      config: { port_name: '', baud_rate: 115200, can_bitrate: 'Bps500k' } satisfies SlcanConfig },
    protocol: await prepareProtocolDocument({ kind: 'Slcan' }, TAB),
    // 不设「协议转换」: Slcan 产 CAN 帧而非数值帧, 重编码为 JustFloat 语义不成立
    widgetDocs: [],
    edges: [],
    extraDataTabs: [{ id: 'can-main', type: 'can', name: 'CAN', closable: true }],
  });
}

async function serialTemplate(): Promise<AppSnapshot> {
  const [g0, g1, n2, n3] = await prepareWidgetSpecs([
    { modelId: 'widget:Gauge', nodeId: 'g-ch0', label: 'CH0', position: { x: WIDGET_COL1_X, y: 60 } },
    { modelId: 'widget:Gauge', nodeId: 'g-ch1', label: 'CH1', position: { x: WIDGET_COL2_X, y: 60 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-ch2', label: 'CH2', position: { x: WIDGET_COL1_X, y: 260 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-ch3', label: 'CH3', position: { x: WIDGET_COL2_X, y: 260 } },
  ]);
  return buildSnapshot({
    name: 'Serial',
    device: simulatedSerial(4, 100),
    protocol: await prepareProtocolDocument({ kind: 'JustFloat', channels: null }, TAB),
    convertTo: { kind: 'JustFloat', channels: null },
    widgetDocs: [g0, g1, n2, n3],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'g-ch0', targetHandle: 'value' },
      { id: 'e2', source: PROTOCOL_ID, sourceHandle: 'ch1', target: 'g-ch1', targetHandle: 'value' },
      { id: 'e3', source: PROTOCOL_ID, sourceHandle: 'ch2', target: 'nd-ch2', targetHandle: 'value' },
      { id: 'e4', source: PROTOCOL_ID, sourceHandle: 'ch3', target: 'nd-ch3', targetHandle: 'value' },
    ],
  });
}

async function demoTemplate(): Promise<AppSnapshot> {
  const [fLp, ndLp, mSin, gSin, wf] = await prepareWidgetSpecs([
    { modelId: 'widget:Filter', variantId: 'Lowpass', nodeId: 'f-lp', label: 'Lowpass',
      position: { x: WIDGET_COL1_X, y: 60 }, configPatch: { cutoff: 50, sampleRate: 1000 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-lp', label: 'filtered', position: { x: WIDGET_COL2_X, y: 60 } },
    { modelId: 'widget:Math', variantId: 'sin', nodeId: 'm-sin', label: 'sin', position: { x: WIDGET_COL1_X, y: 220 } },
    { modelId: 'widget:Gauge', nodeId: 'g-sin', label: 'sin(ch1)', position: { x: WIDGET_COL2_X, y: 220 } },
    { modelId: 'widget:Waveform', nodeId: 'wf', label: 'Filtered', position: { x: WIDGET_COL1_X, y: 400 },
      configPatch: { channels: 4, dynamicSeries: true } },
  ]);
  return buildSnapshot({
    name: 'Demo',
    device: simulatedSerial(4, 1000),
    protocol: await prepareProtocolDocument({ kind: 'JustFloat', channels: 4 }, TAB),
    convertTo: { kind: 'JustFloat', channels: 4 },
    widgetDocs: [fLp, ndLp, mSin, gSin, wf],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'f-lp', targetHandle: 'in0' },
      { id: 'e2', source: 'f-lp', sourceHandle: 'result', target: 'nd-lp', targetHandle: 'value' },
      { id: 'e3', source: 'f-lp', sourceHandle: 'result', target: 'wf', targetHandle: 'CH0' },
      { id: 'e4', source: PROTOCOL_ID, sourceHandle: 'ch1', target: 'm-sin', targetHandle: 'in0' },
      { id: 'e5', source: 'm-sin', sourceHandle: 'result', target: 'g-sin', targetHandle: 'value' },
    ],
  });
}

async function fftTemplate(): Promise<AppSnapshot> {
  // 频域流水线: ch0 → FFT 求解器 → 频谱仪 (连线即数据源) → IFFT 重建回时域 → 波形对比
  const [fft, spec, ifft, wf] = await prepareWidgetSpecs([
    { modelId: 'widget:FFT', nodeId: 'fft-main', label: 'FFT', position: { x: WIDGET_COL1_X, y: 60 },
      configPatch: { windowSize: 512, windowType: 'Hann', output: 'Magnitude', sampleRate: 1000 } },
    { modelId: 'widget:Spectrum', nodeId: 'spec-main', label: 'Spectrum', position: { x: WIDGET_COL2_X, y: 60 } },
    { modelId: 'widget:IFFT', nodeId: 'ifft-main', label: 'IFFT', position: { x: WIDGET_COL2_X, y: 280 } },
    { modelId: 'widget:Waveform', nodeId: 'wf-ifft', label: 'Original vs IFFT', position: { x: WIDGET_COL1_X, y: 280 },
      configPatch: { channels: 4, dynamicSeries: true } },
  ]);
  return buildSnapshot({
    name: 'FFT',
    device: simulatedSerial(4, 1000),
    protocol: await prepareProtocolDocument({ kind: 'JustFloat', channels: 4 }, TAB),
    convertTo: { kind: 'JustFloat', channels: 4 },
    widgetDocs: [fft, spec, ifft, wf],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'fft-main', targetHandle: 'in0' },
      { id: 'e2', source: 'fft-main', sourceHandle: 'spectrum', target: 'spec-main', targetHandle: 'spectrum' },
      { id: 'e3', source: 'fft-main', sourceHandle: 'spectrum', target: 'ifft-main', targetHandle: 'spectrum' },
      { id: 'e4', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'wf-ifft', targetHandle: 'CH0' },
      { id: 'e5', source: 'ifft-main', sourceHandle: 'out0', target: 'wf-ifft', targetHandle: 'CH1' },
    ],
  });
}

/// 自定义协议演示: custom 块协议 (命名端口) + 多帧 CommandSender
/// 帧布局与测试属性生成的 JustFloat 线缆格式一致 (2×float32LE + 帧尾)。
async function customProtocolTemplate(): Promise<AppSnapshot> {
  const customSchema: ProtocolSchema = {
    preset: 'custom',
    decode: [
      { id: 'cp-f0', type: 'field', fieldType: 'float32LE', portName: 'speed' },
      { id: 'cp-f1', type: 'field', fieldType: 'float32LE', portName: 'temp' },
      { id: 'cp-tail', type: 'tail', hex: '00 00 80 7F' },
    ],
    encode: [
      { type: 'varRef', params: { portName: 'speed', fieldType: 'float32LE' } },
      { type: 'varRef', params: { portName: 'temp', fieldType: 'float32LE' } },
      { type: 'constHex', params: { hex: '00 00 80 7F' } },
    ],
  };
  const [cmd, wf, gTemp, raw] = await prepareWidgetSpecs([
    { modelId: 'widget:Command', nodeId: 'cmd-main', label: 'Command', position: { x: WIDGET_COL1_X, y: 260 },
      configPatch: {
        frames: [
          {
            id: 'cmd-main-frame-1',
            label: 'Ping',
            blocks: [
              { id: 'b1', type: 'const_hex', hex: 'AA 01' },
              { id: 'b2', type: 'checksum', checksum: 'sum8' },
            ],
            appendNewline: false,
            sendMode: 'manual',
            timerMs: 1000,
          },
          {
            id: 'cmd-main-frame-2',
            label: 'Set Speed',
            blocks: [
              { id: 'b3', type: 'const_hex', hex: 'BB' },
              { id: 'b4', type: 'var_ref', portName: 'speed', fieldType: 'float32LE' },
            ],
            appendNewline: false,
            sendMode: 'manual',
            timerMs: 1000,
          },
        ],
      } },
    { modelId: 'widget:Waveform', nodeId: 'wf-custom', label: 'Speed', position: { x: WIDGET_COL2_X, y: 60 },
      configPatch: { channels: 4, dynamicSeries: true } },
    { modelId: 'widget:Gauge', nodeId: 'g-temp', label: 'Temp', position: { x: WIDGET_COL2_X, y: 260 } },
    { modelId: 'widget:RawData', nodeId: 'raw-custom', label: 'RawData', position: { x: WIDGET_COL3_X, y: 160 } },
  ]);
  return buildSnapshot({
    name: 'Custom Protocol',
    // 测试属性按自定义 schema 的编码块生成字节流，custom decode 负责解析。
    device: simulatedSerial(2, 1000),
    protocol: { protocol: { kind: 'JustFloat', channels: 2 }, schema: customSchema },
    convertTo: { kind: 'JustFloat', channels: 2 },
    widgetDocs: [cmd, wf, gTemp, raw],
    edges: [
      // 命名端口 → 波形/仪表 (schema 派生端口 speed/temp)
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'speed', target: 'wf-custom', targetHandle: 'CH0' },
      { id: 'e2', source: PROTOCOL_ID, sourceHandle: 'temp', target: 'g-temp', targetHandle: 'value' },
      // 协议字节出口 → RawData (动态端口 src:<id>:out)
      { id: 'e3', source: PROTOCOL_ID, sourceHandle: 'out', target: 'raw-custom', targetHandle: rawDataPortId(PROTOCOL_ID, 'out') },
      // 多帧发送器 → 设备写入口
      { id: 'e4', source: 'cmd-main', sourceHandle: 'loopbackOut', target: TRANSPORT_ID, targetHandle: 'tx' },
    ],
  });
}

/// 文本协议演示 — "str → 数值"的协议转换:
/// 设备送 ASCII CSV 文本 (FireWater), 协议引擎解析后经「协议转换」重编码为
/// JustFloat 数值帧; 转换结果沿 out 继续下推, 解析出的数值通道直接进数字显示与波形。
async function textProtocolTemplate(): Promise<AppSnapshot> {
  const [ndCh0, ndCh1, wf] = await prepareWidgetSpecs([
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-text-ch0', label: 'CH0', position: { x: WIDGET_COL1_X, y: 60 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-text-ch1', label: 'CH1', position: { x: WIDGET_COL2_X, y: 60 } },
    { modelId: 'widget:Waveform', nodeId: 'wf-text', label: 'Text → numbers', position: { x: WIDGET_COL1_X, y: 240 },
      configPatch: { channels: 2, dynamicSeries: true } },
  ]);
  return buildSnapshot({
    name: 'Text',
    // 文本线缆: 仿真按 FireWater (ASCII CSV) 编码, 与协议子节点的解析格式一致
    device: simulatedSerial(2, 100),
    protocol: await prepareProtocolDocument({ kind: 'FireWater', channels: 2 }, TAB),
    convertTo: { kind: 'JustFloat', channels: 2 },
    widgetDocs: [ndCh0, ndCh1, wf],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'nd-text-ch0', targetHandle: 'value' },
      { id: 'e2', source: PROTOCOL_ID, sourceHandle: 'ch1', target: 'nd-text-ch1', targetHandle: 'value' },
      { id: 'e3', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'wf-text', targetHandle: 'CH0' },
      { id: 'e4', source: PROTOCOL_ID, sourceHandle: 'ch1', target: 'wf-text', targetHandle: 'CH1' },
    ],
  });
}

export const QUICK_START_TEMPLATES: QuickStartTemplate[] = [
  { id: 'math', nameKey: 'templateMath', descKey: 'templateMathDesc', build: mathTemplate },
  { id: 'filter', nameKey: 'templateFilter', descKey: 'templateFilterDesc', build: filterTemplate },
  { id: 'fft', nameKey: 'templateFft', descKey: 'templateFftDesc', build: fftTemplate },
  { id: 'can', nameKey: 'templateCan', descKey: 'templateCanDesc', build: canTemplate },
  { id: 'serial', nameKey: 'templateSerial', descKey: 'templateSerialDesc', build: serialTemplate },
  { id: 'custom-protocol', nameKey: 'templateCustomProtocol', descKey: 'templateCustomProtocolDesc', build: customProtocolTemplate },
  { id: 'text-protocol', nameKey: 'templateTextProtocol', descKey: 'templateTextProtocolDesc', build: textProtocolTemplate },
  { id: 'demo', nameKey: 'templateDemo', descKey: 'templateDemoDesc', build: demoTemplate },
];

export function getTemplate(id: string): QuickStartTemplate | undefined {
  return QUICK_START_TEMPLATES.find((t) => t.id === id);
}


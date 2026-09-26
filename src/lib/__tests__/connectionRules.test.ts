import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  edgeHandlesValid,
  nodePortTable,
  resolvePortDomain,
  validateConnection,
  type DerivedPort,
} from '../utils/connectionRules';
import { useDescribeStore } from '../models/describeStore';
import type { NodeDescription } from '../../types/generated/NodeDescription';
import type { NodePortDescriptor } from '../../types/generated/NodePortDescriptor';

/// 控件端口唯一权威 = describe_node_documents — 测试以描述夹具驱动
function port(handle: string, domain: NodePortDescriptor['domain']): NodePortDescriptor {
  return { handle, label: '', domain, connectDomains: [], dynamic: false, maxConnections: null };
}
function adoptDescription(nodeId: string, inputs: NodePortDescriptor[], outputs: NodePortDescriptor[]): void {
  const description: NodeDescription = {
    nodeId, requestRevision: 1, status: 'ready', inputs, outputs,
    defaultInput: null, defaultOutput: null, effectiveChannels: null, hint: null, issues: [],
  };
  useDescribeStore.getState().adopt([description]);
}
adoptDescription('w1', [port('CH0', 'F32'), port('CH1', 'F32')], []);
adoptDescription('w-fft', [port('in0', 'F32')], [port('spectrum', 'Spectrum')]);
adoptDescription('w-gauge', [port('value', 'F32')], []);

const TRANSPORT: Node = {
  id: 'tp1',
  type: 'acquisition',
  position: { x: 0, y: 0 },
  data: { tabId: 'default', label: 'Serial', ports: [
    { id: 'tx', direction: 'input', domain: 'bytes' },
    { id: 'rx', direction: 'output', domain: 'bytes' },
  ], spec: { id: 'tp1', label: 'Serial' } },
};

const PROTOCOL: Node = {
  id: 'pt1',
  type: 'protocol',
  position: { x: 100, y: 0 },
  data: {
    tabId: 'default',
    config: { kind: 'JustFloat', channels: 2 },
    convertTo: null,
    channels: 2,
    label: 'JustFloat',
  },
};

const WAVEFORM: Node = {
  id: 'w1',
  type: 'widget',
  position: { x: 200, y: 0 },
  data: {
    tabId: 'default',
    widget: { kind: 'Waveform', params: { id: 'w1', channels: 2 } },
  },
};

const FFT: Node = {
  id: 'w-fft',
  type: 'widget',
  position: { x: 200, y: 100 },
  data: {
    tabId: 'default',
    widget: { kind: 'FFT', params: { id: 'w-fft' } },
  },
};

const GAUGE: Node = {
  id: 'w-gauge',
  type: 'widget',
  position: { x: 300, y: 0 },
  data: {
    tabId: 'default',
    widget: { kind: 'Gauge', params: { id: 'w-gauge', min: 0, max: 100, unit: '', channel: null } },
  },
};

const RAWDATA_WIDGET: Node = {
  id: 'w-raw',
  type: 'widget',
  position: { x: 300, y: 100 },
  data: { tabId: 'default', widget: { kind: 'RawData', params: { id: 'w-raw' } } },
};

const RAWDATA_PROTOCOL: Node = {
  id: 'pt-raw',
  type: 'protocol',
  position: { x: 100, y: 100 },
  data: {
    tabId: 'default',
    config: { kind: 'RawData' },
    convertTo: null,
    channels: 4,
    label: 'RawData',
  },
};

const CTX = {
  nodes: [TRANSPORT, PROTOCOL, WAVEFORM, FFT, GAUGE, RAWDATA_WIDGET, RAWDATA_PROTOCOL],
  derivedPorts: {
    pt1: { ports: [{ name: 'ch0', domain: 'F32' }, { name: 'ch1', domain: 'F32' }] as DerivedPort[] },
    'pt-raw': { ports: [{ name: 'str', domain: 'String' }] as DerivedPort[] },
  },
};

describe('nodePortTable (统一端口表)', () => {
  it('transport: rx/tx 字节域', () => {
    const t = nodePortTable(TRANSPORT, CTX);
    expect(t.outputs).toEqual([{ id: 'rx', domain: 'bytes' }]);
    expect(t.inputs).toEqual([{ id: 'tx', domain: 'bytes' }]);
  });

  it('protocol: in/out 字节 + 数值口读 derivedPorts', () => {
    const t = nodePortTable(PROTOCOL, CTX);
    expect(t.inputs).toEqual([{ id: 'in', domain: 'bytes' }]);
    expect(t.outputs[0]).toEqual({ id: 'out', domain: 'bytes' });
    expect(t.outputs.slice(1)).toEqual([
      { id: 'ch0', domain: 'time' },
      { id: 'ch1', domain: 'time' },
    ]);
  });

  it('RawData 预设 protocol 的 str 口是字符串域', () => {
    const t = nodePortTable(RAWDATA_PROTOCOL, CTX);
    expect(t.outputs).toContainEqual({ id: 'str', domain: 'string' });
    expect(t.outputs.some((p) => p.id.startsWith('ch'))).toBe(false);
  });

  it('RawData widget: 描述未到达 (absent) 时空表, 动态 src: 口随描述更新', () => {
    const t = nodePortTable(RAWDATA_WIDGET, CTX);
    expect(t.inputs).toEqual([]);
  });
});

describe('validateConnection (同域校验)', () => {
  it('时域→时域 放行', () => {
    const r = validateConnection(CTX, { source: 'pt1', target: 'w1', sourceHandle: 'ch0', targetHandle: 'CH0' });
    expect(r.ok).toBe(true);
  });

  it('频域→时域 拒绝并说明原因', () => {
    const r = validateConnection(CTX, { source: 'w-fft', target: 'w1', sourceHandle: 'spectrum', targetHandle: 'CH0' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('freq');
    expect(r.message).toContain('time');
  });

  it('字节→时域 拒绝', () => {
    const r = validateConnection(CTX, { source: 'tp1', target: 'w1', sourceHandle: 'rx', targetHandle: 'CH0' });
    expect(r.ok).toBe(false);
  });

  it('字节→字节 放行 (transport.rx → protocol.in)', () => {
    const r = validateConnection(CTX, { source: 'tp1', target: 'pt1', sourceHandle: 'rx', targetHandle: 'in' });
    expect(r.ok).toBe(true);
  });

  it('RawData widget 接受时域源', () => {
    const r = validateConnection(CTX, { source: 'pt1', target: 'w-raw', sourceHandle: 'ch0', targetHandle: 'data' });
    expect(r.ok).toBe(true);
  });

  it('RawData widget 拒绝频域源', () => {
    const r = validateConnection(CTX, { source: 'w-fft', target: 'w-raw', sourceHandle: 'spectrum', targetHandle: 'data' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('freq');
  });

  it('目标端口不存在 → 拒绝并列出可选端口', () => {
    const r = validateConnection(CTX, { source: 'pt1', target: 'w1', sourceHandle: 'ch0', targetHandle: 'CH9' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('CH0');
  });

  it('源端口不存在 (derivedPorts 停滞的 ch9) → 拒绝', () => {
    const r = validateConnection(CTX, { source: 'pt1', target: 'w1', sourceHandle: 'ch9', targetHandle: 'CH0' });
    expect(r.ok).toBe(false);
  });

  it('跨 tab widget 连线 → 拒绝', () => {
    const otherTabGauge: Node = {
      id: 'w-g2',
      type: 'widget',
      position: { x: 0, y: 0 },
      data: {
        tabId: 'tab2',
        widget: { kind: 'Gauge', params: { id: 'w-g2', min: 0, max: 100, unit: '', channel: null } },
      },
    };
    const r = validateConnection(
      { nodes: [...CTX.nodes, otherTabGauge] },
      { source: 'w1', target: 'w-g2', sourceHandle: 'CH0', targetHandle: 'value' }
    );
    // Waveform 无输出口; 先用 Math.result → 其他 tab gauge 触发跨 tab 检查
    const math: Node = {
      id: 'w-math',
      type: 'widget',
      position: { x: 0, y: 0 },
      data: { tabId: 'default', widget: { kind: 'Math', params: { id: 'w-math', op: 'add', inputCount: 1 } } },
    };
    const r2 = validateConnection(
      { nodes: [math, otherTabGauge] },
      { source: 'w-math', target: 'w-g2', sourceHandle: 'result', targetHandle: 'value' }
    );
    expect(r.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r2.message).toContain('tab');
  });

  it('节点不存在 → 拒绝并提示先查询', () => {
    const r = validateConnection(CTX, { source: 'ghost', target: 'w1', sourceHandle: 'rx', targetHandle: 'CH0' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('ghost');
  });

  it('字符串域 → 数值域 拒绝 (RawData 预设 str → gauge)', () => {
    const r = validateConnection(CTX, { source: 'pt-raw', target: 'w-gauge', sourceHandle: 'str', targetHandle: 'value' });
    expect(r.ok).toBe(false);
  });
});

describe('edgeHandlesValid (悬空边判定)', () => {
  it('端口存在的边放行', () => {
    expect(edgeHandlesValid(CTX, { source: 'tp1', sourceHandle: 'rx', target: 'pt1', targetHandle: 'in' })).toBe(true);
  });

  it('handle 不存在的边判为悬空', () => {
    expect(edgeHandlesValid(CTX, { source: 'tp1', sourceHandle: 'rx', target: 'pt1', targetHandle: 'in9' })).toBe(false);
  });

  it('RawData 的 src: 目标口按派生约定放行', () => {
    expect(edgeHandlesValid(CTX, { source: 'pt1', sourceHandle: 'ch0', target: 'w-raw', targetHandle: 'src:pt1:ch0' })).toBe(true);
  });

  it('端点节点缺失时拒绝悬空边', () => {
    expect(edgeHandlesValid(CTX, { source: 'gone', sourceHandle: 'x', target: 'w1', targetHandle: 'CH0' })).toBe(false);
  });
});

describe('resolvePortDomain (域解析)', () => {
  it('protocol in/out 恒为字节域', () => {
    expect(resolvePortDomain(PROTOCOL, 'in', 'target', CTX)).toBe('bytes');
    expect(resolvePortDomain(PROTOCOL, 'out', 'source', CTX)).toBe('bytes');
  });

  it('FrameDecoder 拒绝未声明的 loopbackIn 端口', () => {
    const decoder: Node = {
      id: 'w-dec',
      type: 'widget',
      position: { x: 0, y: 0 },
      data: { tabId: 'default', widget: { kind: 'FrameDecoder', params: { id: 'w-dec', blocks: [] } } },
    };
    expect(resolvePortDomain(decoder, 'loopbackIn', 'target', {})).toBeNull();
  });
});

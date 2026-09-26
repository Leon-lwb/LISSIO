import { beforeEach, describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { nodeDefinition } from '../registry';
import { useDescribeStore } from '../../../lib/models/describeStore';
import { useAppStore } from '../../../store/appStore';
import type { NodeDescription } from '../../../types/generated/NodeDescription';
import type { NodePortDescriptor } from '../../../types/generated/NodePortDescriptor';

/// 端口表的前端消费守卫: 端口内容唯一权威是 describe_node_documents,
/// registry.ports 只做 wire→UI 词表映射 (后端端口表语义由 widgets/tests.rs 保证)。

function port(handle: string, domain: NodePortDescriptor['domain']): NodePortDescriptor {
  return { handle, label: '', domain, connectDomains: [], dynamic: false, maxConnections: null };
}

function adoptDescription(nodeId: string, inputs: NodePortDescriptor[], outputs: NodePortDescriptor[]): void {
  const description: NodeDescription = {
    nodeId,
    requestRevision: 1,
    status: 'ready',
    inputs,
    outputs,
    defaultInput: null,
    defaultOutput: null,
    effectiveChannels: null,
    hint: null,
    issues: [],
  };
  useDescribeStore.getState().adopt([description]);
}

function widgetNode(id: string, kind: string): Node {
  return {
    id,
    type: 'widget',
    position: { x: 0, y: 0 },
    data: { tabId: 'default', widget: { kind, params: { id, label: kind } } },
  };
}

const EMPTY_CTX = {} as never;

describe('registry.ports - describe 映射', () => {
  beforeEach(() => {
    useDescribeStore.getState().clear();
    useAppStore.setState({ rfNodes: [], rfEdges: [] });
  });

  it('Command 多帧端口并集经描述透传 (去重保序在 后端/描述侧 完成)', () => {
    adoptDescription('cmd-1',
      [port('speed', 'F32'), port('temp', 'F32')],
      [port('loopbackOut', 'Bytes')]);
    const table = nodeDefinition(widgetNode('cmd-1', 'Command')).ports(widgetNode('cmd-1', 'Command'), EMPTY_CTX);
    expect(table.inputs.map((p) => p.id)).toEqual(['speed', 'temp']);
    expect(table.outputs.map((p) => ({ id: p.id, domain: p.domain }))).toEqual([
      { id: 'loopbackOut', domain: 'bytes' },
    ]);
  });

  it('Str 字符串/数值域按描述词表映射 (mid: str+pos+len → result)', () => {
    adoptDescription('s1',
      [port('str', 'String'), port('pos', 'F32'), port('len', 'F32')],
      [port('result', 'String')]);
    const table = nodeDefinition(widgetNode('s1', 'Str')).ports(widgetNode('s1', 'Str'), EMPTY_CTX);
    expect(table.inputs.map((p) => ({ id: p.id, domain: p.domain }))).toEqual([
      { id: 'str', domain: 'string' },
      { id: 'pos', domain: 'time' },
      { id: 'len', domain: 'time' },
    ]);
    expect(table.outputs[0].domain).toBe('string');
  });

  it('TextInput 无输入, 输出恰为 str (string 域)', () => {
    adoptDescription('ti-1', [], [port('str', 'String')]);
    const table = nodeDefinition(widgetNode('ti-1', 'TextInput')).ports(widgetNode('ti-1', 'TextInput'), EMPTY_CTX);
    expect(table.inputs).toEqual([]);
    expect(table.outputs.map((p) => ({ id: p.id, domain: p.domain }))).toEqual([{ id: 'str', domain: 'string' }]);
  });

  it('Model3D 姿态端口 (欧拉/四元数) 随描述切换', () => {
    adoptDescription('m3d-1', [port('x', 'F32'), port('y', 'F32'), port('z', 'F32'), port('roll', 'F32'), port('pitch', 'F32'), port('yaw', 'F32')], []);
    expect(nodeDefinition(widgetNode('m3d-1', 'Model3D')).ports(widgetNode('m3d-1', 'Model3D'), EMPTY_CTX).inputs.map((p) => p.id))
      .toEqual(['x', 'y', 'z', 'roll', 'pitch', 'yaw']);
    adoptDescription('m3d-1', [port('x', 'F32'), port('y', 'F32'), port('z', 'F32'), port('q0', 'F32'), port('q1', 'F32'), port('q2', 'F32'), port('q3', 'F32')], []);
    expect(nodeDefinition(widgetNode('m3d-1', 'Model3D')).ports(widgetNode('m3d-1', 'Model3D'), EMPTY_CTX).inputs.map((p) => p.id))
      .toEqual(['x', 'y', 'z', 'q0', 'q1', 'q2', 'q3']);
  });

  it('Spectrum 域映射为 freq', () => {
    adoptDescription('fft-1', [port('in0', 'F32')], [port('spectrum', 'Spectrum')]);
    const table = nodeDefinition(widgetNode('fft-1', 'FFT')).ports(widgetNode('fft-1', 'FFT'), EMPTY_CTX);
    expect(table.outputs[0].domain).toBe('freq');
  });

  it('描述缺失 (absent/pending) 时端口表为空 — 不本地回退', () => {
    const table = nodeDefinition(widgetNode('w-1', 'Knob')).ports(widgetNode('w-1', 'Knob'), EMPTY_CTX);
    expect(table.inputs).toEqual([]);
    expect(table.outputs).toEqual([]);
  });
});

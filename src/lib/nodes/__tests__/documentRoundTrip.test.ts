import { describe, expect, it } from 'vitest';
import { canvasNode, nodeDocument, type NodeDocument } from '../document';
import type { AcquisitionNodeData } from '../../acquisition/acquisitionNodes';
import {
  deviceDocument,
  pointSelectorDocument,
  protocolDocument,
  widgetDocument,
} from '../../../test/nodeDocuments';

// 每个业务家族: document -> ReactFlow 节点 -> document 必须无损往返。
// wire 上的 kind 名称保持 'pointSelector'，ReactFlow 适配层使用 'point-selector'。
describe('NodeDocument <-> ReactFlow round trip', () => {
  const cases: [string, NodeDocument][] = [
    ['device', deviceDocument()],
    ['protocol', protocolDocument()],
    ['pointSelector', pointSelectorDocument()],
    ['widget', widgetDocument()],
  ];

  for (const [name, doc] of cases) {
    it(`round trips ${name} documents losslessly`, () => {
      const node = canvasNode(doc);
      expect(node.type).toBe(name === 'pointSelector' ? 'point-selector' : name === 'device' ? 'acquisition' : name);
      const roundTripped = nodeDocument(node);
      expect(roundTripped).toEqual(doc);
    });
  }

  it('nodeDocument accepts the canvas point-selector spelling', () => {
    const node = canvasNode(pointSelectorDocument());
    expect(node.type).toBe('point-selector');
    expect(() => nodeDocument(node)).not.toThrow();
    expect(nodeDocument(node).kind).toBe('pointSelector');
  });

  it('canvasNode keeps the wire pointSelector kind distinct from the node type', () => {
    const doc = pointSelectorDocument();
    const node = canvasNode(doc);
    expect(node.type).not.toBe(doc.kind);
    if (doc.kind === 'pointSelector') {
      expect((node.data as { points: string[] }).points).toEqual(doc.config.points);
    }
  });

  // 设备配置负载 = 扁平驱动参数 (与 golden fixture / configSchema 同层)。
  // v0.7.0 的 prepare 曾写进 `{ kind, params }` 信封 → 属性面板整页读不到值
  // (全部显示首选项且「选中当前显示值」不触发 change)。水合时合成一次,
  // 之后按当前格式 (负载) 写回持久化文档。
  it('unwraps the legacy device transport envelope to the flat payload', () => {
    const doc = deviceDocument();
    if (doc.kind !== 'device') throw new Error('fixture must be a device document');
    const defaults = {
      port_name: '',
      baud_rate: 115200,
      data_bits: 8,
      parity: 'none',
      stop_bits: 'one',
      flow_control: 'none',
    };
    // 真实坏文档形状: 发现到的端口落在信封顶层, 用户编辑同样写顶层
    doc.config.node.config = {
      kind: 'Serial',
      params: defaults,
      port_name: '/dev/cu.usbserial-1120',
      baud_rate: 9600,
    };
    const expected = { ...defaults, port_name: '/dev/cu.usbserial-1120', baud_rate: 9600 };

    const node = canvasNode(doc);
    expect((node.data as AcquisitionNodeData).node.config).toEqual(expected);

    const roundTripped = nodeDocument(node);
    if (roundTripped.kind !== 'device') throw new Error('round trip must stay a device document');
    expect(roundTripped.config.node.config).toEqual(expected);
  });

  it('leaves contract-shaped flat device payloads untouched', () => {
    const doc = deviceDocument();
    if (doc.kind !== 'device') throw new Error('fixture must be a device document');
    const node = canvasNode(doc);
    expect((node.data as AcquisitionNodeData).node.config).toEqual(doc.config.node.config);
  });
});

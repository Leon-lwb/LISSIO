import { describe, expect, it } from 'vitest';
import { canvasNode, nodeDocument, type NodeDocument } from '../document';
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
});

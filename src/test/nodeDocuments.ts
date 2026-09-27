//! 测试文档夹具 — 后端导出的 golden fixtures (rpc-api/tests/fixtures 同源),
//! 本模块只做 id/tabId 重排, 不再维护一套 TS 默认工厂。
//!
//! fixture 的 serde 合同由后端 contract_fixtures.rs 固定; 前端消费同一份
//! JSON 保证两端文档形态一致。

import type { Node } from '@xyflow/react';
import type { ProtocolSchema } from '../types';
import type { NodeDocument } from '../lib/nodes/document';
import { canvasNode } from '../lib/nodes/document';
import deviceFixture from './fixtures/node_document_device_serial.json';
import widgetFixture from './fixtures/node_document_widget_math.json';
import pointSelectorFixture from './fixtures/node_document_point_selector.json';
import justfloatSchemaFixture from './fixtures/protocol_schema_justfloat.json';

const DEVICE_DOC = deviceFixture as unknown as NodeDocument & { kind: 'device' };
const WIDGET_DOC = widgetFixture as unknown as NodeDocument & { kind: 'widget' };
const POINT_SELECTOR_DOC = pointSelectorFixture as unknown as NodeDocument & { kind: 'pointSelector' };

function clone(doc: NodeDocument): NodeDocument {
  return structuredClone(doc);
}

/** id 重排 — 设备树子节点 id (`<root>::simulation`) 一并替换。 */
function reIdentify(doc: NodeDocument, id: string, tabId: string): NodeDocument {
  const next = clone(doc);
  const oldId = next.id;
  next.id = id;
  next.tabId = tabId;
  if (next.kind === 'device') {
    next.config.node.id = id;
    for (const child of next.config.node.children) {
      if (child.id.startsWith(`${oldId}::`)) {
        child.id = `${id}::${child.id.slice(oldId.length + 2)}`;
      }
    }
  }
  return next;
}

export function deviceDocument(id = 'device', tabId = 'default'): NodeDocument {
  return reIdentify(DEVICE_DOC, id, tabId);
}

export function protocolDocument(id = 'parser', tabId = 'default'): NodeDocument {
  const schema = structuredClone(justfloatSchemaFixture) as unknown as ProtocolSchema;
  const protocol = schema.presetConfig ?? { kind: 'JustFloat', channels: null };
  return {
    id,
    tabId,
    label: 'Parser',
    kind: 'protocol',
    layout: { x: 320, y: 60, width: null, height: null },
    config: { protocol, convertTo: null, schema },
  };
}

export function widgetDocument(id = 'widget', tabId = 'default'): NodeDocument {
  return reIdentify(WIDGET_DOC, id, tabId);
}

export function pointSelectorDocument(id = 'points-1', tabId = 'default', points?: string[]): NodeDocument {
  const doc = reIdentify(POINT_SELECTOR_DOC, id, tabId);
  if (doc.kind === 'pointSelector' && points) doc.config.points = [...points];
  return doc;
}

export function documentNodes(): Node[] {
  return [deviceDocument(), protocolDocument(), widgetDocument()].map(doc => canvasNode(doc));
}

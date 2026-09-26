//! 协议 schema 数据的纯派生/判读 helper — 前端唯一的 schema 消费面。
//!
//! 预设工厂 (justfloat/firewater/… schemaFromProtocolConfig / protocolPortNames /
//! getEffectiveChannels) 已删除: schema 的单一来源是模型目录 prepare
//! (schema_types::preset), 节点端口的单一来源是 describe_node_documents。
//! 本模块只读取持久化在文档里的 schema 数据 (用户编辑的 custom 块等)。

import type { DecoderBlock, ProtocolConfig, ProtocolSchema } from '../../types';

/// 从 decode 块派生端口列表 (与 Rust ProtocolSchema::port_names 规则一致):
/// field.portName / bitfield.portName / csv.ports / asciiField.portName,
/// 按块顺序去重 (保持首次出现顺序)。length/id/checksum/header/tail/samples 不占端口。
export function schemaPortNames(decode: DecoderBlock[]): string[] {
  const ports: string[] = [];
  for (const b of decode) {
    if (b.type === 'field' || b.type === 'bitfield' || b.type === 'asciiField') {
      if (!ports.includes(b.portName)) ports.push(b.portName);
    } else if (b.type === 'csv') {
      for (const p of b.ports) {
        if (!ports.includes(p)) ports.push(p);
      }
    }
  }
  return ports;
}

/// RawData 预设判定 (覆盖有/无 schema 两种数据形态; custom 块编辑后不再是预设)
/// RawData 引擎不产数值帧: 收到字节后 out(Bytes) 透传 + UTF-8 lossy 文本进 str 字符串口
export function isRawDataPreset(nodeData: { config: ProtocolConfig; schema?: ProtocolSchema | null }): boolean {
  const schema = nodeData.schema;
  if (schema?.preset === 'custom') return false;
  return schema?.preset === 'rawData' || nodeData.config.kind === 'RawData';
}

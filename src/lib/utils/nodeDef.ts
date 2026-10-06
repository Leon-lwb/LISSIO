//! 图同步适配工具 — RawData 动态端口 id 约定、Custom 端口声明提取、边 DTO。
//!
//! 旧的 widget→NodeKind lowering 已删除: NodeDocument 是图提交的统一 wire,
//! widget 的业务 lowering 由后端编译器/注册表承担; 本模块只保留前端侧
//! 仍需要的适配工具 (计划 WP8: 清除旧 lowering 前检索消费者)。

import type { Edge } from '@xyflow/react';
import type { WidgetConfig } from '../../types';
import { evalCustomWidgetDef } from '../models/customWidgetDef';

/// RawData 动态输入端口 id 约定: `src:<sourceId>:<sourceHandle>`
/// 每个已连接的 (source, sourceHandle) 组合 = 一个通道端口 (后端 describe 同规则派生)
export function rawDataPortId(sourceId: string, sourceHandle?: string | null): string {
  return `src:${sourceId}:${sourceHandle ?? 'data'}`;
}

/// Custom 控件的端口声明提取 — NodeDocument.customPorts 的单一来源。
/// 声明随文档持久化 (后端据此产出 Custom 端口与描述), 代码解析失败时
/// 回退单默认输入口 `value` (与后端默认一致)。
export function customWidgetPortDeclaration(widget: Extract<WidgetConfig, { kind: 'Custom' }>): {
  inputs: string[];
  outputs: string[];
} {
  const { def } = evalCustomWidgetDef(widget.params.code);
  return {
    inputs: (def?.inputs ?? [{ id: 'value', label: 'value' }]).map((p) => p.id),
    outputs: (def?.outputs ?? []).map((p) => p.id),
  };
}

/// 边 DTO — 与 Rust vofa_next_buffer::graph::Edge 对应 (snake_case)
export interface GraphEdge {
  id: string;
  source: string;
  source_handle: string;
  target: string;
  target_handle: string;
}

/// 将 React Flow Edge (camelCase: sourceHandle/targetHandle) 转为后端 DTO (snake_case: source_handle/target_handle)
export function edgeToGraphEdge(edge: Edge): GraphEdge {
  return {
    id: edge.id,
    source: edge.source,
    source_handle: edge.sourceHandle ?? '',
    target: edge.target,
    target_handle: edge.targetHandle ?? '',
  };
}

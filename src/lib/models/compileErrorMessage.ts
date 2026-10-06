//! 编译错误 → 人类可读消息。
//!
//! 纯函数, 不含 React 也不含 store: 画布节点的错误浮标与编译错误列表都渲染同一条
//! 消息, 两处各写一份翻译必然漂移。放在实现层是因为调用方分属视图层的不同目录。

import type { CompileError } from '../../store/slices/compileError';

/// 节点命中错误时渲染人类可读消息 (后端 GraphCompileError 1:1 镜像)
export function compileErrorMessage(err: CompileError, nodeId: string): string {
  switch (err.kind) {
    case 'value_cycle':
      return `Value cycle: ${err.cycle.join(' → ')}`;
    case 'byte_cycle':
      return `Byte cycle: ${err.cycle.join(' → ')}`;
    case 'domain_mismatch': {
      if (err.source_node === nodeId) {
        return `Domain mismatch on out ${err.source_port} (${err.src_domain})`;
      }
      if (err.target === nodeId) {
        return `Domain mismatch on in ${err.target_port} (${err.tgt_domain})`;
      }
      return `Domain mismatch: ${err.source_port}(${err.src_domain}) → ${err.target_port}(${err.tgt_domain})`;
    }
    case 'node_not_found':
      return err.id === nodeId ? 'Node not found in compiled graph' : `Node "${err.id}" not found`;
    case 'port_not_found':
      return err.node_id === nodeId
        ? `${err.output ? 'Output' : 'Input'} port "${err.port}" is not declared`
        : `Port "${err.port}" is not declared by node "${err.node_id}"`;
    default:
      return 'Compile error';
  }
}

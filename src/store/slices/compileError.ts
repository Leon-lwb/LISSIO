/// 后端 `error::CompileReport` / `error::CompileError` 的 TypeScript 镜像.
/// 强类型契约 — `graph:compile` 事件 payload 字段, 与 Rust 侧 `error/src/compile.rs` 1:1.

export type PortDomain = 'points' | 'f32' | 'bytes' | 'string' | 'spectrum';

export type CompileError =
  | { kind: 'value_cycle'; cycle: string[] }
  | { kind: 'byte_cycle'; cycle: string[] }
  | {
      kind: 'domain_mismatch';
      edge_id: string;
      source_node: string;
      source_port: string;
      src_domain: PortDomain;
      target: string;
      target_port: string;
      tgt_domain: PortDomain;
    }
  | { kind: 'node_not_found'; id: string }
  | { kind: 'port_not_found'; edge_id: string; node_id: string; port: string; output: boolean };

export interface CompileReport {
  error: CompileError;
  nodes: string[];
  edges: string[];
}

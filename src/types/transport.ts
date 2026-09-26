// ============ 传输层类型 ============
//
// wire 类型由 Rust 生成 (src/types/generated/, check:contracts 阻止漂移),
// 本文件只做 re-export; 禁止手写 wire 镜像。

export type { ConnectionState } from './generated/ConnectionState';
export type { PortInfo } from './generated/PortInfo';
export type { TransportStats } from './generated/TransportStats';
export type { SerialConfig } from './generated/SerialConfig';
export type { UdpConfig } from './generated/UdpConfig';
export type { TcpClientConfig } from './generated/TcpClientConfig';
export type { TcpServerConfig } from './generated/TcpServerConfig';
export type { TestDataConfig } from './generated/TestDataConfig';
export type { TestSignal } from './generated/TestSignal';
export type { TransportConfig } from './generated/TransportConfig';

// ============ 协议层类型 ============

// 协议配置 — wire 权威在 schema_types::ProtocolConfig (含 Diagnostic 变体)
export type { ProtocolConfig } from './generated/ProtocolConfig';

// 前端类型入口 — 设备与能力。
//
// wire 类型由 Rust 生成 (`src/types/generated/`, 由 check:contracts 阻止漂移),
// 本文件只做 re-export 与少量前端视图类型, 禁止手写 wire 镜像。
export const CAPABILITY_CONTRACT_VERSION = 1;

import type { PointQuality as GeneratedPointQuality } from './generated/PointQuality';
import type { PointValue as GeneratedPointValue } from './generated/PointValue';
import type { JsonValue } from './generated/serde_json/JsonValue';

// ---- 生成 wire 类型 re-export (保留前端历史命名) ----
//
// 能力描述符的词表字段 (protocol/transport/direction/domain) 在前端是**开放词表**
// (设计决策): 较新的 adapter 可能上报本前端不认识的取值, 它们必须仍能通过通用
// 卡片渲染 (见 deviceCardModel.test.ts)。generated 枚举是 wire 拼写的权威;
// 下面的视图类型只把词表字段放宽为 string, 其余字段保持生成形状。

import type {
  AdapterCapability as GeneratedAdapterCapability,
} from './generated/AdapterCapability';
import type {
  EndpointDescriptor as GeneratedEndpointDescriptor,
} from './generated/EndpointDescriptor';
import type {
  PortDescriptor as GeneratedPortDescriptor,
} from './generated/PortDescriptor';
import type {
  RuntimeStatus as GeneratedRuntimeStatus,
} from './generated/RuntimeStatus';
import type {
  DisplaySemantics as GeneratedDisplaySemantics,
} from './generated/DisplaySemantics';
import type {
  DriverProjection as GeneratedDriverProjection,
} from './generated/DriverProjection';

export type RuntimeStatus = Omit<GeneratedRuntimeStatus, 'state'> & { state: string };

export type PortDescriptor = Omit<GeneratedPortDescriptor, 'direction' | 'dataDomain'> & {
  direction: string;
  dataDomain: string;
};

export type EndpointDescriptor = Omit<GeneratedEndpointDescriptor, 'transport' | 'direction' | 'ports' | 'status'> & {
  transport: string;
  direction: string;
  status: RuntimeStatus;
  ports: PortDescriptor[];
};

export type AdapterCapability = Omit<
  GeneratedAdapterCapability,
  'protocol' | 'transport' | 'direction' | 'dataDomains' | 'endpoints' | 'display'
> & {
  protocol: string;
  transport: string;
  direction: string;
  dataDomains: string[];
  endpoints: EndpointDescriptor[];
  display: GeneratedDisplaySemantics | null;
};

export type { CapabilitySet } from './generated/CapabilitySet';
export type { DisplaySemantics } from './generated/DisplaySemantics';
export type { AddressRegion } from './generated/AddressRegion';
export type { AddressSpaceDescriptor } from './generated/AddressSpaceDescriptor';
export type { DiscoveredEndpoint } from './generated/DiscoveredEndpoint';
export type { DriverPayload } from './generated/DriverPayload';
export type { CapabilityMask } from './generated/CapabilityMask';
export type { RuntimeState as CapabilityRuntimeState } from './generated/RuntimeState';
export type {
  NodeState as DeviceNodeState,
} from './generated/NodeState';
export type {
  NodeSnapshot as DeviceTreeNodeSnapshot,
} from './generated/NodeSnapshot';
export type DriverManifestProjection = Omit<
  GeneratedDriverProjection,
  'ports'
> & {
  ports: PortDescriptor[];
};
export type { SignalParameters } from './generated/SignalParameters';
export type { SimulationConfig } from './generated/SimulationConfig';
export type { SessionCapabilities } from './generated/SessionCapabilities';
export type { AcquisitionIntent } from './generated/AcquisitionIntent';
export type { EffectiveSubscription } from './generated/EffectiveSubscription';
export type { PointValue } from './generated/PointValue';
export type { PointQuality } from './generated/PointQuality';
export type { PointDescriptor } from './generated/PointDescriptor';
export type {
  NodeDecl as DeviceTreeNodeDecl,
} from './generated/NodeDecl';

// ---- 前端视图类型 (非 wire 镜像) ----

/// 表单引擎消费的 JSON Schema 子集 — `ConfigurationSchema.jsonSchema` (JsonValue)
/// 的收窄视图。schemaForm 只支持该子集; 任何更宽的形式必须给出明确提示。
export interface JsonSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  default?: JsonValue;
  enum?: JsonValue[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean;
}

/// 画布连接视角的节点状态子集 (disabled/validating 不进入连接判定)。
export type EndpointConnectionState =
  | { state: 'connecting' | 'closing' | 'closed' }
  | { state: 'online'; connection_epoch: number }
  | { state: 'degraded'; detail: string }
  | { state: 'backoff'; attempt: number };

/// 点位采样 (envelope 之后的载荷视图; envelope 合同待后续工作包导出)。
export interface PointSample {
  key: { sourceId: string; pointId: string };
  value: GeneratedPointValue | null;
  quality: GeneratedPointQuality;
  sourceTimeUnixNs: number | null;
  serverTimeUnixNs: number | null;
  receivedTimeUnixNs: number;
}

/// 点位读取结果 (envelope 视图)。
export interface PointReadResult {
  batch: {
    sourceId: string;
    connectionEpoch: number;
    firstSequence: number;
    lastSequence: number;
    observedTimeUnixNs: number;
    direction: 'receive' | 'transmit';
    payload: { delivery: 'state' | 'event'; samples: PointSample[] };
  };
}

/// 点位写入请求 (envelope 合同待后续工作包导出)。
export interface PointWriteRequest {
  correlationId: string;
  deadlineUnixNs: number;
  idempotencyKey: string | null;
  items: { pointId: string; value: GeneratedPointValue }[];
}

/// 点位写入结果。
export interface PointWriteResult {
  correlationId: string;
  items: { pointId: string; quality: GeneratedPointQuality }[];
}

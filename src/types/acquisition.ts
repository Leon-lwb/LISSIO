export const CAPABILITY_CONTRACT_VERSION = 1;

/// Capability descriptors are an open backend-owned vocabulary. Keeping these
/// values open lets a newer adapter render through the generic card without a
/// matching frontend release.
export type ProtocolKind = string;
export type CapabilityTransport = string;
export type EndpointDirection = string;
export type CapabilityPortDirection = string;
export type CapabilityDataDomain = string;
export type CapabilityRuntimeState = string;

export interface CapabilitySet {
  byteSource: boolean;
  byteSink: boolean;
  discover: boolean;
  browse: boolean;
  read: boolean;
  subscribe: boolean;
  write: boolean;
  method: boolean;
}

export interface JsonSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean;
}

export interface ConfigurationSchema {
  schemaVersion: number;
  jsonSchema: JsonSchema;
  uiHints: Record<string, Record<string, unknown>>;
}

export interface DisplaySemantics {
  category?: string;
  symbol?: string;
  tags: string[];
}

export interface AddressRegion {
  id: string;
  displayName: string;
  minimum: number;
  maximum: number;
  readable: boolean;
  writable: boolean;
}

export interface AddressSpaceDescriptor {
  unit: string;
  regions: AddressRegion[];
}

export interface PortDescriptor {
  id: string;
  displayName: string;
  direction: CapabilityPortDirection;
  dataDomain: CapabilityDataDomain;
  operations: CapabilitySet;
  addressSpace?: AddressSpaceDescriptor;
  dataTypes: string[];
  display?: DisplaySemantics;
}

export interface EndpointDescriptor {
  id: string;
  displayName: string;
  transport: CapabilityTransport;
  direction: EndpointDirection;
  status: { state: CapabilityRuntimeState; detail?: string };
  ports: PortDescriptor[];
  configuration: ConfigurationSchema;
  display?: DisplaySemantics;
}

export interface AdapterCapability {
  contractVersion: number;
  adapterId: string;
  displayName: string;
  protocol: ProtocolKind;
  transport: CapabilityTransport;
  direction: EndpointDirection;
  operations: CapabilitySet;
  dataDomains: CapabilityDataDomain[];
  endpoints: EndpointDescriptor[];
  display?: DisplaySemantics;
}

export interface DiscoveredEndpoint {
  adapterId: string;
  discoveryId: string;
  displayName: string;
  configurationPatch: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface DriverPayload {
  driverId: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
}

export interface EndpointSpec {
  id: string;
  label: string;
  enabled: boolean;
  capabilityEndpointId?: string;
  driver: DriverPayload;
  simulation?: SimulationConfig | null;
}

export interface SignalParameters {
  waveform: 'sine' | 'square' | 'triangle' | 'sawtooth' | 'random' | 'dc';
  frequency: number;
  amplitude: number;
  offset: number;
}

export interface SimulationConfig {
  signal: SignalParameters;
  sampleRate: number;
  seed: number;
  channels: number;
  overrides: Record<string, SignalParameters>;
  referenceNodeId: string | null;
  encoding: Record<string, unknown> | null;
}

export type EndpointConnectionState =
  | { state: 'connecting' | 'closing' | 'closed' }
  | { state: 'online'; connectionEpoch: number }
  | { state: 'degraded'; detail: string }
  | { state: 'backoff'; attempt: number };

export interface PointDescriptor {
  id: string;
  path: string[];
  name: string;
  dataType: string;
  access: 'readOnly' | 'writeOnly' | 'readWrite';
  engineeringUnit: string | null;
  semantic: Record<string, string>;
  nativeAddress: { domain: string; value: unknown };
}

export interface SessionCapabilities {
  available: CapabilitySet;
  maxReadPoints: number;
  maxWritePoints: number;
  minPeriodMs: number | null;
  maxPeriodMs: number | null;
  sourceTimestamps: boolean;
  serverTimestamps: boolean;
  idempotentWrites: boolean;
}

export interface EndpointSnapshot {
  id: string;
  label: string;
  adapterId: string;
  capabilityEndpointId?: string;
  state: EndpointConnectionState;
  capabilities?: SessionCapabilities;
  points: PointDescriptor[];
}

export type PointValue =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'i64' | 'u64' | 'decimal' | 'string' | 'dateTime'; value: string }
  | { kind: 'f64'; value: number }
  | { kind: 'bytes'; value: number[] }
  | { kind: 'enum'; value: { value: string; label?: string } }
  | { kind: 'array'; value: PointValue[] }
  | { kind: 'struct'; value: { name: string; value: PointValue }[] };

export interface PointQuality {
  validity: 'good' | 'uncertain' | 'bad';
  flags: number;
  native: { domain: string; code: string; detail: string | null } | null;
}

export interface PointSample {
  key: { sourceId: string; pointId: string };
  value: PointValue | null;
  quality: PointQuality;
  sourceTimeUnixNs: number | null;
  serverTimeUnixNs: number | null;
  receivedTimeUnixNs: number;
}

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

export interface AcquisitionIntent {
  mode: 'auto' | 'poll' | 'subscribe' | 'onDemand';
  requestedPeriodMs: number | null;
  deadband: number | null;
  priority: 'low' | 'normal' | 'high';
  delivery: 'state' | 'event';
}

export interface EffectiveSubscription {
  accepted: string[];
  rejected: { pointId: string; reason: string }[];
  effectivePeriodMs: number | null;
  ordered: boolean;
  mayHaveGaps: boolean;
}

export interface PointWriteRequest {
  correlationId: string;
  deadlineUnixNs: number;
  idempotencyKey: string | null;
  items: { pointId: string; value: PointValue }[];
}

export interface PointWriteResult {
  correlationId: string;
  items: { pointId: string; quality: PointQuality }[];
}

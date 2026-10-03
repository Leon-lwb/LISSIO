//! Web transport wire types and protocol helpers.

import type {
  EventChannel,
  RpcError,
  SubscribeOptions,
} from './types';

/// Binary stream frame header: `[u8 version][u8 format][u32 BE subscription id][u32 BE payload length]`.
export const BINARY_FRAME_VERSION = 1;
export const BINARY_FRAME_HEADER = 10;

/// WebSocket subprotocol and bearer-token prefix.
export const WS_PROTOCOL = 'lissio.v2';
export const WS_TOKEN_PREFIX = 'bearer.';

/// Reconnect backoff bounds.
export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 8_000;

export interface WebEndpoint {
  base: string;
  token: string;
}

export function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  const name = match?.[1]?.trim();
  return name === undefined || name === '' ? null : name;
}

export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface SubscribedMessage { type: 'subscribed'; id: number }
export interface StreamMessage { type: 'stream'; id: number; payload: unknown }
export interface EventMessage { type: 'event'; event: string; payload: unknown }
export interface NotifyMessage {
  type: 'notify';
  level: string;
  message: string;
  url?: string | null;
}
export interface FaultMessage { type: 'fault'; message: string; id?: number | null }
export interface ChannelMessage { type: 'channel'; id: number; payload: unknown }
export interface ResponseMessage {
  type: 'response';
  id: number;
  ok: boolean;
  result?: unknown;
  error?: unknown;
}
export type ServerMessage =
  | SubscribedMessage
  | StreamMessage
  | EventMessage
  | NotifyMessage
  | FaultMessage
  | ChannelMessage
  | ResponseMessage
  | { type: string };

export interface WebEventChannel<T> extends EventChannel<T> { $channel: number }

export interface SubscriptionRecord {
  request: unknown;
  options: SubscribeOptions | undefined;
  sink: (payload: unknown) => void;
  id: number | null;
  live: boolean;
  settle: () => void;
}

export interface PendingCall {
  id: number;
  cmd: string;
  args: Record<string, unknown> | undefined;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export function rpcFailure(kind: string, message: string): RpcError {
  return { kind, message };
}

export function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function drop<T>(items: T[], item: T): void {
  const index = items.indexOf(item);
  if (index >= 0) items.splice(index, 1);
}

export function isTerminalChannelPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || !('type' in payload)) return false;
  const type = (payload as { type?: unknown }).type;
  return type === 'done' || type === 'cancelled' || type === 'error';
}

export function isWebEventChannel(value: unknown): value is WebEventChannel<unknown> {
  return value !== null && typeof value === 'object' && '$channel' in value;
}

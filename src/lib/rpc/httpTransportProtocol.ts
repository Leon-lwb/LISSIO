//! Web transport wire types and protocol helpers.
//!
//! The frame types and protocol constants are generated from the Rust wire
//! (`backend_server::frames` + `examples/export_frames.rs`) by
//! `pnpm generate:contracts`; this module only forwards them so the frontend has
//! exactly one definition. `check:contracts` fails both on drift and on a local
//! re-declaration of a frame type name.

import type { ServerMessage } from '../../types/generated/ServerMessage';
import type { EventChannel, RpcError, SubscribeOptions } from './types';

export type { ServerMessage };
export {
  BINARY_FRAME_HEADER,
  BINARY_FRAME_VERSION,
  PROTOCOL_VERSION,
  WS_SUBPROTOCOL as WS_PROTOCOL,
  WS_TOKEN_PREFIX,
} from '../../types/generated/WebProtocol';

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

// ---- `ServerMessage` members ----
//
// The generated union is the single source of the frame shape; the decoder
// switches on its `type` discriminants and keeps a `default` branch, so an
// unknown `type` tag is ignored exactly as before.

/// Fault member — the decoder passes it to `handleFault`.
export type FaultMessage = Extract<ServerMessage, { type: 'fault' }>;

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

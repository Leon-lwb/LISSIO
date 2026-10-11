//! Desktop and Web settings use the authenticated, currently connected backend.
//! Reads are fresh; queued writes cannot follow a reconnect to another backend.

import { getBackendEndpoint } from '../rpc';
import type { PlatformStore } from './types';

// All store instances share ordering, including config import and settings edits.
let pending: Promise<unknown> = Promise.resolve();

export function createBackendStore(fileName: string): PlatformStore {
  if (fileName !== 'settings.json') throw new Error(`Unsupported settings file: ${fileName}`);

  async function enqueue<T>(operation: (endpoint: ReturnType<typeof getBackendEndpoint>) => Promise<T>) {
    const endpoint = getBackendEndpoint();
    const result = pending.then(async () => {
      assertCurrent(endpoint);
      return await operation(endpoint);
    });
    pending = result.catch(() => undefined);
    return result;
  }

  async function readDocument(endpoint: ReturnType<typeof getBackendEndpoint>) {
    const response = await fetch(`${endpoint.base}/api/v1/settings`, {
      headers: authHeaders(endpoint.token),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Settings read failed: HTTP ${response.status}`);
    const document: unknown = await response.json();
    assertCurrent(endpoint);
    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      throw new Error('Settings response is not a JSON object');
    }
    return document as Record<string, unknown>;
  }

  return {
    get: <T,>(key: string) => enqueue(async (endpoint) => {
      const document = await readDocument(endpoint);
      return (document[key] as T | undefined) ?? null;
    }),
    set: (key, value) => {
      // Freeze the requested value before waiting for earlier writes.
      const snapshot: unknown = structuredClone(value);
      return enqueue(async (endpoint) => {
        const document = await readDocument(endpoint);
        assertCurrent(endpoint);
        const response = await fetch(`${endpoint.base}/api/v1/settings`, {
          method: 'PUT',
          headers: { ...authHeaders(endpoint.token), 'content-type': 'application/json' },
          body: JSON.stringify({ ...document, [key]: snapshot }),
        });
        if (!response.ok) throw new Error(`Settings save failed: HTTP ${response.status}`);
        assertCurrent(endpoint);
      });
    },
  };
}

function assertCurrent(endpoint: ReturnType<typeof getBackendEndpoint>): void {
  if (getBackendEndpoint() !== endpoint) throw new Error('Backend connection changed during settings access');
}

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

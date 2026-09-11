import type { RecordingHistoryRow } from '../../../store/recordingDatabaseStore';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function formatDurationUs(durationUs: number | null): string {
  if (durationUs === null) return '--';
  if (durationUs < 1_000) return `${durationUs} us`;
  if (durationUs < 1_000_000) return `${(durationUs / 1_000).toFixed(2)} ms`;
  return `${(durationUs / 1_000_000).toFixed(2)} s`;
}

export function formatTimestampUs(timestampUs: number): string {
  const date = new Date(timestampUs / 1_000);
  return date.toLocaleString(undefined, {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function formatHex(data: number[]): string {
  return data.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

export function payloadPreview(row: RecordingHistoryRow, maxItems = 4): string {
  const payload = row.payload;
  if (payload == null) return '--';
  switch (row.domain) {
    case 'bytes': {
      const data = asNumberArray(payload.data);
      return data.length > maxItems
        ? `${formatHex(data.slice(0, maxItems))} … (${data.length} B)`
        : formatHex(data);
    }
    case 'string': {
      const values = asStringArray(payload.values);
      return values.slice(0, maxItems).join(' | ');
    }
    case 'float': {
      const values = asNumberArray(payload.values);
      return values
        .slice(0, maxItems)
        .map((value) => (Number.isFinite(value) ? value.toPrecision(6) : String(value)))
        .join(', ');
    }
    case 'spectrum': {
      const frequencies = asNumberArray(payload.frequencies);
      const values = asNumberArray(payload.values);
      const count = Math.min(frequencies.length, values.length, maxItems);
      const parts: string[] = [];
      for (let index = 0; index < count; index += 1) {
        parts.push(`${frequencies[index].toPrecision(4)} Hz: ${values[index].toPrecision(4)}`);
      }
      return parts.join(' | ');
    }
    default:
      return '--';
  }
}

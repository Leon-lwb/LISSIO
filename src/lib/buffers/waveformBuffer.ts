import type { WaveformWindow, WaveformWindowPayload } from '../../types';
import { createFrameBatcher } from '../utils/frameBatcher';

let nextWaveformCacheVersion = 1;

function normalizeSamples(values: (number | null)[]): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] ?? NaN;
  return out;
}

/**
 * 快照查询 (invoke JSON) 路径的归一化 — null→NaN + TypedArray 化。
 * 波形流走 WWB1 二进制 (lib/data/waveformProtocol.ts), 无 null 问题。
 */
export function normalizeWaveformWindow(payload: WaveformWindowPayload): WaveformWindow {
  const derived: WaveformWindow['derived'] = {};
  for (const [sinkId, sources] of Object.entries(payload.derived)) {
    const normalizedSources: Record<string, Record<string, Float32Array>> = {};
    for (const [sourceId, handles] of Object.entries(sources)) {
      const normalizedHandles: Record<string, Float32Array> = {};
      for (const [sourceHandle, values] of Object.entries(handles)) {
        normalizedHandles[sourceHandle] = normalizeSamples(values);
      }
      normalizedSources[sourceId] = normalizedHandles;
    }
    derived[sinkId] = normalizedSources;
  }
  return {
    ...payload,
    timestamps: Float64Array.from(payload.timestamps),
    channels: payload.channels.map(normalizeSamples),
    derived,
  };
}

/// 波形窗口缓存 — 接收来自后端 Tauri Channel 的推送, 由订阅者维护
/// 不同于旧的 WaveformBuffer (前端持有完整数据), 此处仅缓存最新窗口快照
export class WaveformWindowCache {
  private latest: WaveformWindow = emptyWaveformWindow();
  private _version = 0;
  private listeners = new Set<() => void>();
  private statsListeners = new Set<(usage: number, length: number, capacity: number) => void>();
  /// 统计通知按帧合并: 同一帧内多次 set/clear 只通知一次, 避免状态栏 30FPS+ 重渲染
  private statsBatcher = createFrameBatcher<{ usage: number; length: number; capacity: number }>(
    (s) => this.flushStats(s.usage, s.length, s.capacity)
  );

  set(window: WaveformWindow) {
    this.latest = window;
    this._version = nextWaveformCacheVersion++;
    this.notify();
    this.statsBatcher.push(this.currentStats());
  }

  get(): WaveformWindow {
    return this.latest;
  }

  get version(): number {
    return this._version;
  }

  clear() {
    this.latest = emptyWaveformWindow();
    this._version = nextWaveformCacheVersion++;
    this.notify();
    this.statsBatcher.push(this.currentStats());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /// 订阅波形缓存使用率统计, usage ∈ [0,1]
  subscribeStats(fn: (usage: number, length: number, capacity: number) => void): () => void {
    this.statsListeners.add(fn);
    const stats = this.currentStats();
    fn(stats.usage, stats.length, stats.capacity);
    return () => this.statsListeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  private currentStats() {
    const capacity = Math.max(1, this.latest.buffer_capacity);
    const length = this.latest.buffer_points;
    return { usage: length / capacity, length, capacity };
  }

  private flushStats(usage: number, length: number, capacity: number) {
    this.statsListeners.forEach((fn) => fn(usage, length, capacity));
  }
}

function emptyWaveformWindow(): WaveformWindow {
  return {
    seq: 0,
    timestamps: new Float64Array(0),
    channels: [],
    channel_count: 0,
    derived: {},
    buffer_points: 0,
    buffer_capacity: 1,
    latest_timestamp_us: 0,
    raw_window_points: 0,
    sampling: 'raw',
  };
}

/// 全局波形窗口缓存
export const waveformWindow = new WaveformWindowCache();

/// 共享空波形缓存 — 无数据源时的占位 (各 hook 共用同一实例, 永不写入)
export const EMPTY_WAVEFORM_CACHE = new WaveformWindowCache();

/// 分片元数据 — 用于把字节偏移映射到时间戳与方向

import { transport } from '../../rpc';
import { subscribeDisplayTransport } from '../../rpc/livePushGate';
import { normalizeWaveformWindow } from '../../buffers/dataBuffer';
import { subscribeDisplay } from '../../buffers/displaySubscription';
import { decodeWaveformWindow } from '../../data/waveformProtocol';
import { perfEvent, tickMetric } from '../../utils/perfLog';
import { clearRawDataBuffer } from '../../buffers/rawDataSubscription';

import type {
  AutoSetSuggestion,
  ProtocolConfig,
  SourceMeasurementsPayload,
  WaveformSeriesSelection,
  WaveformWindow,
  WaveformWindowPayload,
} from '../../../types';

export const waveformApi = {
  setProtocol: (nodeId: string, config: ProtocolConfig) =>
    transport.call<void>('set_protocol', { nodeId, config }),

  // ===== 波形缓冲区 (source = Protocol 节点 id) =====
  /// 订阅波形数据 — 后端 WWB1 二进制快照流 (TypedArray 零拷贝解码)
  /// 返回一个取消订阅函数
  subscribeWaveform: (
    source: string,
    onEvent: (window: WaveformWindow) => void,
    options?: {
      intervalMs?: number;
      maxPoints?: number;
      startMs?: number;
      endMs?: number;
      selection?: WaveformSeriesSelection;
    },
  ) : { cancel: () => void } => {
    perfEvent('subscribe display:waveform');
    const subscription = subscribeDisplayTransport<ArrayBuffer>(
      {
        kind: 'waveform',
        source,
        start_ms: options?.startMs,
        end_ms: options?.endMs,
        selection: options?.selection,
      },
      (buffer) => {
        tickMetric('display:waveform');
        onEvent(decodeWaveformWindow(buffer));
      },
      {
        intervalMs: options?.intervalMs,
        maxItems: options?.maxPoints,
        onError: (e) => console.error('波形订阅失败:', e),
      },
    );
    // 与拆分前一致的返回形状 — 调用方只关心取消
    return { cancel: subscription.cancel };
  },

  /// 订阅后端测量流 — 统计/周期在权威缓冲金字塔快照上计算 (JSON 推送)
  subscribeMeasurements: (
    source: string,
    windowMs: number,
    derived: WaveformSeriesSelection['derived'],
    onEvent: (m: SourceMeasurementsPayload) => void,
    intervalMs?: number,
  ) =>
    subscribeDisplay<SourceMeasurementsPayload>(
      { kind: 'measurements', source, window_ms: windowMs, derived },
      'measurements',
      onEvent,
      { intervalMs },
    ),

  /// 计算自动设置建议 — 后端周期检测 + 1-2-5 拟合 (阻塞线程执行)。
  /// 时基 = PERIODS_SHOWN(2) × 全部被测序列 (通道+派生) 中最慢的基波周期
  computeWaveformAutoset: (
    source: string,
    channels: number[],
    derived: WaveformSeriesSelection['derived'],
    sharedY: boolean,
    currentVPerDiv: number[],
  ) =>
    transport.call<AutoSetSuggestion>('compute_waveform_autoset', {
      source,
      channels,
      derived,
      sharedY,
      currentVPerDiv,
    }),

  createWaveformSnapshot: (source: string) =>
    transport.call<{ snapshot_id: string; overview: WaveformWindowPayload }>(
      'create_waveform_snapshot',
      { source },
    ).then((created) => ({
      snapshot_id: created.snapshot_id,
      overview: normalizeWaveformWindow(created.overview),
    })),

  queryWaveformSnapshot: (
    snapshotId: string,
    startMs: number,
    endMs: number,
    maxPoints: number,
    selection: WaveformSeriesSelection,
  ) => transport.call<WaveformWindowPayload>('query_waveform_snapshot', {
    snapshotId,
    startMs,
    endMs,
    maxPoints,
    selection,
  }).then(normalizeWaveformWindow),

  releaseWaveformSnapshot: (snapshotId: string) =>
    transport.call<void>('release_waveform_snapshot', { snapshotId }),

  getWaveformRawRange: (
    source: string,
    snapshotId: string | null,
    startTimestampUs: number,
    endTimestampUs: number,
    maxRows: number,
    selection: WaveformSeriesSelection,
  ) => transport.call<WaveformWindowPayload>('get_waveform_raw_range', {
    source,
    snapshotId,
    startTimestampUs,
    endTimestampUs,
    maxRows,
    selection,
  }).then(normalizeWaveformWindow),

  exportWaveformCsv: (
    source: string,
    snapshotId: string | null,
    startTimestampUs: number,
    endTimestampUs: number,
    selection: WaveformSeriesSelection,
    path: string,
  ) => transport.call<number>('export_waveform_csv', {
    source,
    snapshotId,
    startTimestampUs,
    endTimestampUs,
    selection,
    path,
  }),

  clearBuffer: (source: string) => transport.call<void>('clear_buffer', { source }),

  setWaveformBufferCapacity: (source: string, maxPoints: number) =>
    transport.call<void>('set_waveform_buffer_capacity', { source, maxPoints }),

  setRawDataBufferCapacity: (source: string, capacity: number) =>
    transport.call<void>('set_rawdata_buffer_capacity', { source, capacity }),

  setCanBufferCapacity: (capacity: number) =>
    transport.call<void>('set_can_buffer_capacity', { capacity }),

  setLogicBufferCapacity: (capacity: number) =>
    transport.call<void>('set_logic_buffer_capacity', { capacity }),

  /// 清空后端原始数据收集器 (source = 字节设备节点 id；缺省清空全部源)
  clearRawDataBuffer: (source?: string) => clearRawDataBuffer(source),
};

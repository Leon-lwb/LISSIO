import { transport } from '../../rpc';
import type { DecoderBlock, FrameDecoderManualResult, InputFormat } from '../../../types';
import type { BackendPerformanceSnapshot } from '../../../types/generated/BackendPerformanceSnapshot';
import type { PipelineConfig } from '../tauriTypes';

export const observabilityApi = {
  parseFrameDecoderInput: (
    blocks: DecoderBlock[],
    input: string,
    format: InputFormat,
    enableValid: boolean,
    enableFrameCount: boolean,
    enableLastTimestamp: boolean,
    enableFps: boolean,
  ) =>
    transport.call<FrameDecoderManualResult>('parse_frame_decoder_input', {
      blocks,
      input,
      format,
      enableValid,
      enableFrameCount,
      enableLastTimestamp,
      enableFps,
    }),

  // ===== 调试 =====
  /// 打开当前 Webview 的开发者工具（检查元素）
  inspectElement: () => transport.call<void>('inspect_element'),

  // ===== 数据管道性能配置 =====
  setPipelineConfig: (config: PipelineConfig) =>
    transport.call<void>('set_pipeline_config', { config }),

  /// 后端进程 / RPC / WebSocket / 数据平面性能快照。
  getBackendPerformance: () =>
    transport.call<BackendPerformanceSnapshot>('get_performance_snapshot'),

  // ===== 四域持久化与历史查询 =====
};

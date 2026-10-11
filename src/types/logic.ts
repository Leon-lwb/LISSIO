// ============ 逻辑分析仪类型 ============
// wire 类型由 Rust 经 ts-rs 生成, 此处转发 src/types/generated 作为唯一事实来源。
// 批次包装 (seq + 数组) 是前端分片重组契约, 未进入 Rust 导出清单, 保留手写。

import type { DecodedEvent } from './generated/DecodedEvent';
import type { LogicSample } from './generated/LogicSample';

export type { LogicSample } from './generated/LogicSample';
export type { I2cEvent } from './generated/I2cEvent';
export type { DecodedEvent } from './generated/DecodedEvent';
export type { LogicDecoderConfig } from './generated/LogicDecoderConfig';

/// 逻辑采样批次 — 与 Rust LogicSampleBatch 对应
export interface LogicSampleBatch {
  /// 组级单调序号 — 分片并发推送时前端按 seq 重组
  seq: number;
  samples: LogicSample[];
}

/// 解码事件批次 — 与 Rust DecodedEventBatch 对应
export interface DecodedEventBatch {
  /// 组级单调序号 — 分片并发推送时前端按 seq 重组
  seq: number;
  events: DecodedEvent[];
}

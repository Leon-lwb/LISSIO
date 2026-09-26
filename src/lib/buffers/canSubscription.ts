import { transport } from '../rpc';
import type {
  CanFrameBatch,
  CanFrame,
  CanFrameFilter,
  CandleDeviceInfo,
} from '../../types';
import type { SubscriptionHandle } from '../rpc/types';
import { subscribeDisplay } from './displaySubscription';

/// 订阅 CAN 帧数据 — 统一分片流 (增量 drain, 首批回溯最近历史, 之后严格增量无重复)
/// 返回取消订阅函数
export function subscribeCanFrames(
  onEvent: (batch: CanFrameBatch) => void,
  options?: { intervalMs?: number; maxFrames?: number; onError?: (error: unknown) => void },
): SubscriptionHandle {
  return subscribeDisplay<CanFrameBatch>(
    { kind: 'can_frames' },
    'can_frames',
    onEvent,
    { intervalMs: options?.intervalMs, maxItems: options?.maxFrames, onError: options?.onError },
  );
}

/// 唯一 CAN wire 过滤类型已收敛到 `types/can`，此处保留兼容导入入口。
export type CanFrameFilterOptions = CanFrameFilter;

/// 订阅带过滤条件的 CAN 帧 — 统一分片流
///
/// 后端只推送匹配 filter 的帧; 游标从最旧可读位置开始,
/// 先拉取全部历史匹配帧, 之后严格增量。前端无需再遍历过滤。
export function subscribeCanFramesFiltered(
  filter: CanFrameFilter,
  onEvent: (batch: CanFrameBatch) => void,
  options?: { intervalMs?: number; maxFrames?: number; onError?: (error: unknown) => void },
): SubscriptionHandle {
  return subscribeDisplay<CanFrameBatch>(
    { kind: 'can_frames', filter },
    'can_frames',
    onEvent,
    { intervalMs: options?.intervalMs, maxItems: options?.maxFrames, onError: options?.onError },
  );
}

/// 发送 CAN 帧 (nodeId = 目标设备节点 id；protocolNode = null 时后端沿字节平面自动解析下游 Protocol 节点)
export function sendCanFrame(
  nodeId: string,
  frame: CanFrame,
  protocolNode?: string | null,
): Promise<void> {
  return transport.call('send_can_frame', {
    nodeId,
    protocolNode: protocolNode ?? null,
    frame,
  });
}

/// 清空 CAN 帧缓冲区
export function clearCanBuffer(): Promise<void> {
  return transport.call('clear_can_buffer');
}

/// 列举所有 candleLight USB 设备
export function listCandleDevices(): Promise<CandleDeviceInfo[]> {
  return transport.call('list_candle_devices');
}

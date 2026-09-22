// ============ CAN 波特率与驱动 payload 强类型契约 ============
//
// 与 Rust `data_model::CanBitrate` / `SlcanConfig` / `CandleConfig` 一一对应。
// 契约名 (Bps10k...Bps1m) 逐字镜像 Rust serde 输出, 大小写不可改动 —
// 后端 schema 的候选列表由 `CanBitrate::ALL` 生成, 此处类型与之逐字一致。

import type { CandleConfig, CanBitrate, SlcanConfig } from '../../types/can';

/// 全部波特率变体, 按速率升序 — 与 Rust `CanBitrate::ALL` 顺序对应
export const CAN_BITRATES = [
  'Bps10k',
  'Bps20k',
  'Bps50k',
  'Bps100k',
  'Bps125k',
  'Bps250k',
  'Bps500k',
  'Bps800k',
  'Bps1m',
] as const satisfies readonly CanBitrate[];

/// 波特率 → bps 换算 — 与 Rust `CanBitrate::bps()` 对应; 键穷举由编译期保证
export const CAN_BITRATE_BPS: Readonly<Record<CanBitrate, number>> = {
  Bps10k: 10_000,
  Bps20k: 20_000,
  Bps50k: 50_000,
  Bps100k: 100_000,
  Bps125k: 125_000,
  Bps250k: 250_000,
  Bps500k: 500_000,
  Bps800k: 800_000,
  Bps1m: 1_000_000,
};

/// CAN 传输驱动 id — 与后端 `assembly.rs` 注册名一致
export type CanDriverId = 'slcan' | 'candle-light';

/// 按 driverId 收窄后的强类型 CAN payload
export type CanDriverPayload = SlcanConfig | CandleConfig;

/// 运行时判别合法的波特率契约名
export function isCanBitrate(value: string): value is CanBitrate {
  return (CAN_BITRATES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/// 把宽泛的 driver payload 收窄为强类型 CAN payload —
/// 修复杂乱 `Record<string, unknown>` 边界: 形状或波特率值非法时返回 null
export function parseCanDriverPayload(
  driverId: string,
  payload: unknown,
): CanDriverPayload | null {
  if (!isRecord(payload)) return null;
  const canBitrate = payload.can_bitrate;
  if (typeof canBitrate !== 'string' || !isCanBitrate(canBitrate)) return null;
  if (driverId === 'slcan') {
    const { port_name, baud_rate } = payload;
    if (typeof port_name !== 'string' || typeof baud_rate !== 'number') return null;
    return { port_name, baud_rate, can_bitrate: canBitrate };
  }
  if (driverId === 'candle-light') {
    const { bus, address, channel } = payload;
    if (typeof bus !== 'number' || typeof address !== 'number' || typeof channel !== 'number') {
      return null;
    }
    return { bus, address, channel, can_bitrate: canBitrate };
  }
  return null;
}

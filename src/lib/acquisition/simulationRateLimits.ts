//! 模拟生成速率上限 —— 前端侧的**展示镜像**, 不是校验权威。
//!
//! 权威在 Rust: 上限本身是 `data_model::simulation::{MAX_SAMPLE_RATE, MAX_FRAME_RATE}`,
//! 量纲分类是 `schema_types::ProtocolConfig::is_frame_oriented`, 越界最终由
//! `acquisition::simulation::validate_for_protocol` 以配置错误拒绝 (不做静默截断)。
//! 这里存在的唯一目的是让输入框给出**正确的用户界面提示**: 同一个 `sampleRate`
//! 在帧定界协议下量纲是帧/秒, 让 UI 允许填到 5 000 000 只会把「按波特率折算帧率」
//! 这类量纲误用推迟到连接时才由后端报错。
//!
//! 因此本模块的漂移不会造成正确性问题, 只会造成界面误导 —— 但也正因如此,
//! 修改 Rust 常量时必须同步这里, 并在本模块的测试里钉住数值。

/** 流式协议速率上限 (采样/秒) — `data_model::simulation::MAX_SAMPLE_RATE`。 */
export const MAX_SAMPLE_RATE = 5_000_000;

/** 帧定界协议速率上限 (帧/秒) — `data_model::simulation::MAX_FRAME_RATE`。 */
export const MAX_FRAME_RATE = 20_000;

/**
 * 每采样点产出一帧报文的协议 — `ProtocolConfig::is_frame_oriented` 的前端镜像。
 *
 * `LogicDecode` **不**在此列: 它每采样点只产出一个字节 (8 通道打包电平),
 * 字节流速率与采样率同阶, 不存在帧数放大。
 */
const FRAME_ORIENTED_PROTOCOLS: ReadonlySet<string> = new Set(['Slcan', 'CandleLight']);

/** 该协议下生成速率的量纲是否为帧率。 */
export function isFrameOrientedProtocol(protocolKind: string | null | undefined): boolean {
  return protocolKind != null && FRAME_ORIENTED_PROTOCOLS.has(protocolKind);
}

/** 该协议下生成速率的合法上界 (采样/秒 或 帧/秒)。 */
export function maxSimulationRate(protocolKind: string | null | undefined): number {
  return isFrameOrientedProtocol(protocolKind) ? MAX_FRAME_RATE : MAX_SAMPLE_RATE;
}

/** 速率输入单位 — 帧定界协议下必须显式说明量纲, 否则 500k 波特率会被照抄进来。 */
export function simulationRateUnit(protocolKind: string | null | undefined): string {
  return isFrameOrientedProtocol(protocolKind) ? '帧/秒' : '采样/秒';
}

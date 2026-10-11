//! 帧解码器手动测试 — 纯预览计算 (无状态)。
//!
//! 实现体在 [`control_api::frame_decoder`] (L3), 与桌面 IPC 的
//! `parse_frame_decoder_input` 是同一份实现 (P3 下沉), 不复制逻辑。
//!
//! 参数形状与前端 `invoke` 一致 (顶层 camelCase 经 [`crate::normalize_args`]
//! 归一): `blocks` / `input` / `format` / `enableValid` / `enableFrameCount` /
//! `enableLastTimestamp` / `enableFps`。

use protocol::InputFormat;
use serde_json::Value;

use crate::args::{RpcError, encode, required};

/// 解析用户输入字符串为帧 (FrameDecoder 手动测试模式)。
///
/// 解析失败不是错误 — 失败原因通过结果的 `error` 字段回传, 与 IPC 契约一致。
#[allow(clippy::fn_params_excessive_bools)] // 4 个 enable_* 是前端契约参数
pub fn parse_frame_decoder_input(cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let blocks: Vec<kind::DecoderBlockDef> = required(args, cmd, "blocks")?;
    let input: String = required(args, cmd, "input")?;
    let format: InputFormat = required(args, cmd, "format")?;
    let enable_valid: bool = required(args, cmd, "enable_valid")?;
    let enable_frame_count: bool = required(args, cmd, "enable_frame_count")?;
    let enable_last_timestamp: bool = required(args, cmd, "enable_last_timestamp")?;
    let enable_fps: bool = required(args, cmd, "enable_fps")?;

    encode(&control_api::frame_decoder::parse_frame_decoder_input(
        blocks,
        input,
        format,
        enable_valid,
        enable_frame_count,
        enable_last_timestamp,
        enable_fps,
    ))
}

#[cfg(test)]
#[path = "frame_decoder_tests.rs"]
mod tests;

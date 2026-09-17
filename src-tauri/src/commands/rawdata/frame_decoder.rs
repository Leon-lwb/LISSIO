//! 帧解码器手动解析 — Tauri IPC 薄壳。
//!
//! 解析实现已下沉到 [`control_api::frame_decoder`] (P3): Web 出口
//! (`rpc-api::frame_decoder::parse_frame_decoder_input`) 与本命令共用同一份实现。
//! 本文件只保留命令签名 (4 个 `enable_*` 布尔参数与前端契约逐一对应, 不做结构化合并)。

use app::InputFormat;
use data_model::Result;

pub use control_api::frame_decoder::FrameDecoderManualResult;

/// 解析用户输入字符串为帧 (用于 FrameDecoder 手动测试模式)
///
/// 解析失败不是错误 — 失败原因通过 `error` 字段回传。
#[tauri::command]
#[allow(clippy::fn_params_excessive_bools)]
pub async fn parse_frame_decoder_input(
    blocks: Vec<app::DecoderBlockDef>,
    input: String,
    format: InputFormat,
    enable_valid: bool,
    enable_frame_count: bool,
    enable_last_timestamp: bool,
    enable_fps: bool,
) -> Result<FrameDecoderManualResult> {
    Ok(control_api::frame_decoder::parse_frame_decoder_input(
        blocks,
        input,
        format,
        enable_valid,
        enable_frame_count,
        enable_last_timestamp,
        enable_fps,
    ))
}

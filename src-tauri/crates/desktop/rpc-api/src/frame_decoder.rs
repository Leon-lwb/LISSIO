//! 帧解码器手动测试 — 纯预览计算 (无状态)。
//!
//! 实现体在 [`control_api::frame_decoder`] (L3), 与桌面 IPC 的
//! `parse_frame_decoder_input` 是同一份实现 (P3 下沉), 不复制逻辑。
//!
//! 参数形状与前端 `invoke` 一致 (顶层 camelCase 经 [`crate::normalize_args`]
//! 归一): `blocks` / `input` / `format` / `enableValid` / `enableFrameCount` /
//! `enableLastTimestamp` / `enableFps`。

use app::InputFormat;
use serde_json::Value;

use crate::args::{RpcError, encode, required};

/// 解析用户输入字符串为帧 (FrameDecoder 手动测试模式)。
///
/// 解析失败不是错误 — 失败原因通过结果的 `error` 字段回传, 与 IPC 契约一致。
#[allow(clippy::fn_params_excessive_bools)] // 4 个 enable_* 是前端契约参数
pub fn parse_frame_decoder_input(cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let blocks: Vec<app::DecoderBlockDef> = required(args, cmd, "blocks")?;
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
mod tests {
    use super::*;
    use crate::args::empty_args;
    use app::{DecoderBlockDef, FieldType};
    use serde_json::json;

    fn blocks() -> serde_json::Value {
        serde_json::to_value(vec![
            DecoderBlockDef::Header {
                id: "h".into(),
                hex: "AA".into(),
                match_id: None,
            },
            DecoderBlockDef::Field {
                id: "f".into(),
                field_type: FieldType::UInt8,
                port_name: "value".into(),
                length_ref: None,
                match_id: None,
            },
        ])
        .expect("blocks 应可序列化")
    }

    fn args() -> serde_json::Value {
        json!({
            "blocks": blocks(),
            "input": "AA 2A",
            "format": "hex",
            "enableValid": true,
            "enableFrameCount": false,
            "enableLastTimestamp": false,
            "enableFps": false,
        })
    }

    /// camelCase 参数经归一后应解析出输出值 (与 IPC 路径同一实现)。
    #[test]
    fn camel_case_args_parse_frame() {
        let normalized = crate::normalize_args(args());
        let result = parse_frame_decoder_input("parse_frame_decoder_input", &normalized)
            .expect("解析命令不应报错");
        assert_eq!(result["consumedBytes"], json!(2));
        assert_eq!(result["outputs"]["value"], json!(42.0));
        assert_eq!(result["valid"], json!(true));
    }

    /// 缺失参数是契约错误 (InvalidArguments), 不是静默默认值。
    #[test]
    fn missing_field_is_invalid_arguments() {
        let error = parse_frame_decoder_input("parse_frame_decoder_input", &empty_args())
            .expect_err("缺参应报错");
        assert_eq!(error.kind, "InvalidArguments");
        assert!(error.message.contains("blocks"));
    }
}

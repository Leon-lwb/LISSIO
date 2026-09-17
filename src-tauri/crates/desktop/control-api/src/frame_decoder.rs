//! 帧解码器手动测试 — 把用户输入的字符串一次性解析为帧输出预览。
//!
//! 原实现是 Tauri 命令层 (`commands/rawdata/frame_decoder.rs`) 的命令体; Web 出口
//! 需要同一条命令 (`parse_frame_decoder_input`), 因此把实现下沉到能力核心,
//! 两个出口共用一份实现 (P3, 见 `docs/architecture/web-exit.md` §9.4)。
//!
//! 纯预览计算: 无状态, 不触碰 `AppState`, 用 blocks 配置建临时 `FrameParser`
//! 解析一帧即弃。解析失败不是错误 — 失败原因通过 `error` 字段回传
//! (与前端 `FrameDecoderManualResult` 契约一致)。

use app::{InputFormat, detect_format, parse_ascii, parse_hex};

/// 帧解码器手动测试结果 (与前端 FrameDecoderManualResult 对应)
///
/// `camelCase` 是前端契约 (`src/types/frameDecoder.ts::FrameDecoderManualResult`
/// 读 `consumedBytes`, `FrameDecoderManualPanel` 直接渲染该字段)。原 IPC 实现漏了
/// 这个重命名, 导致面板显示 `undefined` — 下沉时补上, 两个出口一致。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDecoderManualResult {
    /// 端口名 → 值 (来自 field/bitfield/length/id 块)
    pub outputs: std::collections::HashMap<String, f32>,
    /// 校验是否通过
    pub valid: bool,
    /// 本帧消耗的字节数 (header + 所有 blocks)
    pub consumed_bytes: usize,
    /// 错误信息 (Hex 解析失败 / 帧头未找到 / 帧不完整等)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl FrameDecoderManualResult {
    /// 解析失败的结果 — 空输出 + 原始错误描述。
    fn failed(error: String) -> Self {
        Self {
            outputs: std::collections::HashMap::new(),
            valid: false,
            consumed_bytes: 0,
            error: Some(error),
        }
    }
}

/// 解析用户输入字符串为帧 (用于 FrameDecoder 手动测试模式)
///
/// 使用 blocks 配置创建临时 FrameParser, 调用 parse_once_with_consumed
/// 返回 outputs + valid + consumed_bytes + 可选 error
// 4 个 enable_* 是前端 IPC 契约参数, 与 FrameParser::new 一一对应, 不做结构化合并
#[allow(clippy::fn_params_excessive_bools)]
pub fn parse_frame_decoder_input(
    blocks: Vec<app::DecoderBlockDef>,
    input: String,
    format: InputFormat,
    enable_valid: bool,
    enable_frame_count: bool,
    enable_last_timestamp: bool,
    enable_fps: bool,
) -> FrameDecoderManualResult {
    use app::FrameParser;

    // 1. 解析输入字符串为字节
    let actual_format = match format {
        InputFormat::Auto => detect_format(&input),
        f => f,
    };
    let bytes = match actual_format {
        InputFormat::Hex => match parse_hex(&input) {
            Ok(b) => b,
            Err(e) => return FrameDecoderManualResult::failed(e),
        },
        InputFormat::Ascii => parse_ascii(&input),
        InputFormat::Auto => unreachable!("Auto 已在上方经 detect_format 展开为 Hex/Ascii"),
    };

    // 2. 创建临时 FrameParser (无状态, 仅用于一次性解析)
    let parser = FrameParser::new(
        blocks,
        enable_valid,
        enable_frame_count,
        enable_last_timestamp,
        enable_fps,
    );

    // 3. 解析一帧 — 使用当前系统时间作为时间戳 (微秒)
    let now_us = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_micros()).unwrap_or(u64::MAX));

    match parser.parse_once_with_consumed(&bytes, now_us) {
        Some((frame, consumed)) => FrameDecoderManualResult {
            outputs: frame.outputs,
            valid: frame.valid,
            consumed_bytes: consumed,
            error: None,
        },
        None => FrameDecoderManualResult::failed("无法解析: 未找到帧头或帧不完整".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app::{DecoderBlockDef, FieldType};

    /// 最小帧: Header("AA") + Field(uint8, "value") → 帧 [0xAA, 0x2A] 输出 value=42
    fn blocks() -> Vec<DecoderBlockDef> {
        vec![
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
        ]
    }

    #[test]
    fn hex_input_parses_outputs_and_consumed_bytes() {
        let r = parse_frame_decoder_input(
            blocks(),
            "AA 2A".into(),
            InputFormat::Hex,
            true,
            false,
            false,
            false,
        );
        assert_eq!(r.error, None);
        assert_eq!(r.consumed_bytes, 2, "帧头 1 + 字段 1");
        assert_eq!(r.outputs.get("value"), Some(&42.0));
        assert!(r.valid, "无校验块 → 校验视为通过");
    }

    #[test]
    fn auto_format_detects_hex_and_parses() {
        let r = parse_frame_decoder_input(
            blocks(),
            "AA 2A".into(),
            InputFormat::Auto,
            true,
            false,
            false,
            false,
        );
        assert_eq!(r.error, None, "偶数长度十六进制应自动判定为 Hex");
        assert_eq!(r.outputs.get("value"), Some(&42.0));
    }

    #[test]
    fn header_not_found_reports_parse_error() {
        let r = parse_frame_decoder_input(
            blocks(),
            "BB 2A".into(),
            InputFormat::Hex,
            true,
            false,
            false,
            false,
        );
        assert_eq!(r.outputs.len(), 0);
        assert_eq!(r.consumed_bytes, 0);
        assert!(!r.valid);
        assert!(
            r.error.unwrap_or_default().contains("无法解析"),
            "帧头找不到应报无法解析"
        );
    }

    #[test]
    fn incomplete_frame_reports_parse_error() {
        // 只有帧头没有字段数据 → 帧不完整
        let r = parse_frame_decoder_input(
            blocks(),
            "AA".into(),
            InputFormat::Hex,
            true,
            false,
            false,
            false,
        );
        assert!(
            r.error.unwrap_or_default().contains("无法解析"),
            "帧不完整应报无法解析"
        );
    }

    #[test]
    fn invalid_hex_reports_decode_error() {
        let r = parse_frame_decoder_input(
            blocks(),
            "ZZ".into(),
            InputFormat::Hex,
            true,
            false,
            false,
            false,
        );
        assert!(r.error.is_some(), "hex 解析失败应返回 error 描述");
        assert_eq!(r.consumed_bytes, 0);
    }

    /// wire 形状必须是 camelCase — 前端读 `consumedBytes` (回归护栏)。
    #[test]
    fn wire_shape_is_camel_case() {
        let r = parse_frame_decoder_input(
            blocks(),
            "AA 2A".into(),
            InputFormat::Hex,
            true,
            false,
            false,
            false,
        );
        let value = serde_json::to_value(&r).expect("结果应可序列化");
        assert_eq!(value["consumedBytes"], serde_json::json!(2));
        assert!(
            value.get("consumed_bytes").is_none(),
            "不得回落到 snake_case — 前端读不到该字段"
        );
    }
}

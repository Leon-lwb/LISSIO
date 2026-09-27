//! 帧解码控件 (FrameDecoder) — 字节流解析为通道/状态输出。
//!
//! 输入端口固定 "in" (Bytes); 输出端口按 decode 块派生 (length/id/field/
//! bitfield 的 portName) + 可选 valid/frame_count/last_timestamp/fps + 固定 raw。
//! blocks 与协议 schema 的 DecoderBlockDef 同构 (tag="type" + camelCase)。

// 数值转换均为有界索引/精度语义 (JSON number <-> 定宽整数), 与前端 JS 数值
// 行为对齐; 此处统一豁免逐个标注的噪音。
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::suboptimal_flops
)]

use data_model::panel_descriptor::{PanelDelivery, PanelKind, panel_ops};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::WidgetDefinition;
use super::WidgetPortTable;
use super::params::{bytes_port, f32_port};
use super::{PanelBindingSpec, PanelSpec};

pub(super) type BlockDef = crate::decoder_block::DecoderBlockDef;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[allow(clippy::struct_excessive_bools)]
#[serde(rename_all = "camelCase", default)]
pub struct FrameDecoderParams {
    pub id: String,
    pub label: String,
    pub blocks: Vec<BlockDef>,
    pub enable_valid: bool,
    pub enable_frame_count: bool,
    pub enable_last_timestamp: bool,
    pub enable_fps: bool,
    /// 前端显示模式 (live/history), 图语义不消费
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

impl Default for FrameDecoderParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "FrameDecoder".to_owned(),
            blocks: default_blocks(),
            enable_valid: true,
            enable_frame_count: false,
            enable_last_timestamp: false,
            enable_fps: false,
            mode: Some("live".to_owned()),
        }
    }
}

/// 默认块: 帧头 + 2 字段 + sum8 校验 (与前端 createWidget('FrameDecoder') 一致)
fn default_blocks() -> Vec<BlockDef> {
    serde_json::from_value(json!([
        { "id": "b1", "type": "header", "hex": "AA" },
        { "id": "b2", "type": "field", "fieldType": "uint8", "portName": "field_1" },
        { "id": "b3", "type": "field", "fieldType": "uint8", "portName": "field_2" },
        { "id": "b4", "type": "checksum", "algorithm": "sum8", "cover": "all_prior", "position": "append" },
    ]))
    .expect("default decoder blocks are well-formed")
}

fn decoder_ports(params: &Value) -> WidgetPortTable {
    let parsed: FrameDecoderParams = serde_json::from_value(params.clone()).unwrap_or_default();
    let mut outputs: Vec<super::WidgetPort> = Vec::new();
    for block in &parsed.blocks {
        match block.output_port_name() {
            Some(name) if !name.is_empty() => outputs.push(f32_port(name)),
            _ => {}
        }
    }
    if parsed.enable_valid {
        outputs.push(f32_port("valid"));
    }
    if parsed.enable_frame_count {
        outputs.push(f32_port("frame_count"));
    }
    if parsed.enable_last_timestamp {
        outputs.push(f32_port("last_timestamp"));
    }
    if parsed.enable_fps {
        outputs.push(f32_port("fps"));
    }
    outputs.push(f32_port("raw"));
    WidgetPortTable {
        inputs: vec![bytes_port("in")],
        outputs,
    }
}

pub(super) const FRAME_DECODER_DEF: WidgetDefinition = WidgetDefinition {
    kind: "FrameDecoder",
    category: super::WidgetCategory::Decoder,
    renderer_key: "FrameDecoder",
    fallback_label: "FrameDecoder",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "FrameDecoder",
            "blocks": default_blocks(),
            "enableValid": true, "enableFrameCount": false,
            "enableLastTimestamp": false, "enableFps": false,
            "mode": "live",
        })
    },
    normalize: |params| {
        super::round_trip_params::<FrameDecoderParams>(params);
    },
    ports: decoder_ports,
    lower: |params, _| {
        let parsed: FrameDecoderParams =
            serde_json::from_value(params.clone()).map_err(|e| e.to_string())?;
        Ok(crate::kind::NodeKind::FrameDecoder {
            blocks: parsed.blocks,
            enable_valid: parsed.enable_valid,
            enable_frame_count: parsed.enable_frame_count,
            enable_last_timestamp: parsed.enable_last_timestamp,
            enable_fps: parsed.enable_fps,
        })
    },
    // 帧解码面板: 解码事件走 decoded_events 推送 (与逻辑分析仪同一事件总线),
    // 派生的 f32 输出口另走数值流 — 面板一次性读取取解码事件批。
    panel: Some(PanelSpec {
        panel: PanelKind::FrameDecoder,
        tab_type: "frame-decoder",
        label_key: "dataTabFrameDecoder",
        delivery: PanelDelivery::Both,
        push_request: Some(panel_ops::PUSH_DECODED_EVENTS),
        fetch_op: Some(panel_ops::FETCH_DECODED_EVENTS),
        binding: PanelBindingSpec::EdgeBound,
        default_interval_ms: Some(33),
        default_max_items: Some(200),
    }),
};

pub(super) static FRAME_DECODER: WidgetDefinition = FRAME_DECODER_DEF;

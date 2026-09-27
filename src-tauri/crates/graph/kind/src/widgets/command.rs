//! 命令发送控件 (Command) — 多帧字节流发送器。
//!
//! 归一化补齐缺省字段并为空帧列表补一个空帧; 幂等。
//! 输入端口 = 各帧 var_ref 块 portName 的并集 (去重保序)。

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
use super::params::bytes_port;
use super::{PanelBindingSpec, PanelSpec};
use crate::ports::LOOPBACK_OUT_HANDLE;

/// 数据块类型 (snake_case wire, 与前端 BlockType 一致)
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
pub enum CommandBlockType {
    ConstHex,
    VarRef,
    TypedConst,
    Checksum,
}

/// 单个数据块 — 各类型共享一个宽松结构 (与前端 CommandBlock 对齐);
/// 未使用的类型相关字段保持缺省。label 是 UI 显示名, 后端忽略但不丢弃。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct CommandBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: CommandBlockType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hex: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_script: Option<String>,
}

impl Default for CommandBlock {
    fn default() -> Self {
        Self {
            id: String::new(),
            block_type: CommandBlockType::ConstHex,
            label: None,
            hex: None,
            port_name: None,
            field_type: None,
            value: None,
            checksum: None,
            custom_script: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum CommandSendMode {
    Manual,
    OnChange,
    Timer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct CommandFrame {
    pub id: String,
    pub label: String,
    pub blocks: Vec<CommandBlock>,
    pub append_newline: bool,
    pub send_mode: CommandSendMode,
    pub timer_ms: u32,
}

impl Default for CommandFrame {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "Frame".to_owned(),
            blocks: Vec::new(),
            append_newline: false,
            send_mode: CommandSendMode::Manual,
            timer_ms: 100,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct CommandParams {
    pub id: String,
    pub label: String,
    pub frames: Vec<CommandFrame>,
    pub loopback_enabled: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub loopback_history: Vec<Value>,
}

impl CommandParams {
    /// frames 为空时补一个空帧 (缺省填充)。
    fn ensure_frames(mut self) -> Self {
        if self.frames.is_empty() {
            self.frames = vec![CommandFrame {
                id: format!(
                    "{}-frame-1",
                    if self.id.is_empty() { "cmd" } else { &self.id }
                ),
                ..CommandFrame::default()
            }];
        }
        self
    }
}

/// 收集所有帧 var_ref 块的输入端口名 (并集, 去重, 保序) — 节点输入 handle。
pub fn command_input_port_names(params: &Value) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut names = Vec::new();
    for frame in frames_of(params) {
        for block in &frame.blocks {
            if block.block_type == CommandBlockType::VarRef
                && let Some(name) = block.port_name.as_deref().filter(|name| !name.is_empty())
                && seen.insert(name.to_owned())
            {
                names.push(name.to_owned());
            }
        }
    }
    names
}

/// 归一化后的帧列表 (frames 缺失时为空)。
pub fn frames_of(params: &Value) -> Vec<CommandFrame> {
    serde_json::from_value::<CommandParams>(params.clone())
        .map(|parsed| parsed.frames)
        .unwrap_or_default()
}

fn normalize_command(params: &mut Value) {
    if let Ok(mut wire) = serde_json::from_value::<CommandParams>(params.clone())
        .and_then(|parsed| serde_json::to_value(parsed.ensure_frames()))
    {
        super::merge_unknown(params, &mut wire);
        *params = wire;
    }
}

fn command_ports(params: &Value) -> WidgetPortTable {
    WidgetPortTable {
        inputs: command_input_port_names(params)
            .into_iter()
            .map(super::params::f32_port)
            .collect(),
        outputs: vec![bytes_port(LOOPBACK_OUT_HANDLE)],
    }
}

pub(super) const COMMAND_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Command",
    category: super::WidgetCategory::Command,
    renderer_key: "Command",
    fallback_label: "Command",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Command",
            "frames": [{
                "id": format!("{node_id}-frame-1"),
                "label": "Frame 1",
                "blocks": [
                    { "id": "b1", "type": "const_hex", "label": "帧头", "hex": "AA 01" },
                    { "id": "b2", "type": "var_ref", "label": "速度", "portName": "speed", "fieldType": "uint16LE" },
                    { "id": "b3", "type": "checksum", "label": "校验", "checksum": "sum8" },
                ],
                "appendNewline": false,
                "sendMode": "manual",
                "timerMs": 100,
            }],
            "loopbackEnabled": false,
            "loopbackHistory": [],
        })
    },
    normalize: normalize_command,
    ports: command_ports,
    // Command 的 value 输入端口由图求值读取; 节点本体是 Sink (无 f32 输出)
    lower: |_, _| Ok(crate::kind::NodeKind::Sink),
    // 命令面板: 帧内 var_ref 块的实时端口值走数值流 (port_samples),
    // 一次性读取走数值输出快照 (graphOutputs)。端口集合由 params 派生
    // (frame[].blocks[].portName 并集), 故绑定是 EdgeBound 参数无关形式。
    panel: Some(PanelSpec {
        panel: PanelKind::Command,
        tab_type: "command",
        label_key: "dataTabCommand",
        delivery: PanelDelivery::Both,
        push_request: Some(panel_ops::PUSH_PORT_SAMPLES),
        fetch_op: Some(panel_ops::FETCH_GRAPH_OUTPUTS),
        binding: PanelBindingSpec::EdgeBound,
        default_interval_ms: Some(33),
        default_max_items: None,
    }),
};

pub(super) static COMMAND: WidgetDefinition = COMMAND_DEF;

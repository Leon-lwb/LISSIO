//! 触发器控件 (Trigger) — manual 命令匹配 / auto 边沿检测。

// 数值转换均为有界索引/精度语义 (JSON number <-> 定宽整数), 与前端 JS 数值
// 行为对齐; 此处统一豁免逐个标注的噪音。
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::suboptimal_flops
)]

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::WidgetDefinition;
use super::WidgetPortTable;
use super::params::{f32_port, string_port};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum TriggerMatchType {
    #[default]
    Exact,
    Prefix,
    Contains,
    Regex,
    Range,
    Glob,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct TriggerRule {
    pub id: String,
    #[serde(default)]
    pub pattern: String,
    #[serde(alias = "match_type", default)]
    pub match_type: TriggerMatchType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flags: Option<String>,
    #[serde(alias = "output_type", default)]
    pub output_type: TriggerOutputType,
    #[serde(alias = "output_value", default)]
    pub output_value: f64,
    #[serde(alias = "output_text", default)]
    pub output_text: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

const fn default_true() -> bool {
    true
}

impl Default for TriggerRule {
    fn default() -> Self {
        Self {
            id: String::new(),
            pattern: String::new(),
            match_type: TriggerMatchType::Exact,
            flags: None,
            output_type: TriggerOutputType::Number,
            output_value: 0.0,
            output_text: String::new(),
            enabled: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum TriggerOutputType {
    #[default]
    Number,
    String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum TriggerEdge {
    Level,
    Rising,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct TriggerParams {
    pub id: String,
    pub label: String,
    pub mode: String,
    pub edge: TriggerEdge,
    pub default_miss: f64,
    pub default_miss_text: String,
    pub command: String,
    pub rules: Vec<TriggerRule>,
    pub binding: super::params::InputBinding,
}

impl Default for TriggerParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            mode: "manual".to_owned(),
            edge: TriggerEdge::Level,
            default_miss: 0.0,
            default_miss_text: String::new(),
            command: String::new(),
            rules: Vec::new(),
            binding: super::params::InputBinding::none(),
        }
    }
}

fn trigger_ports(_params: &Value) -> WidgetPortTable {
    WidgetPortTable {
        inputs: vec![f32_port("trigger")],
        outputs: vec![f32_port("value"), f32_port("matched"), string_port("text")],
    }
}

pub(super) const TRIGGER_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Trigger",
    category: super::WidgetCategory::Command,
    renderer_key: "Trigger",
    fallback_label: "Trigger",
    default_params: |node_id| {
        // 子 ID (rule id) 由 node_id 确定性派生 — 重复请求不产生不同 ID
        json!({
            "id": node_id, "label": "Trigger",
            "mode": "manual", "edge": "level",
            "defaultMiss": 0, "defaultMissText": "",
            "command": "HELLO",
            "rules": [{
                "id": format!("{node_id}-rule-1"),
                "pattern": "HELLO",
                "matchType": "exact",
                "outputType": "number",
                "outputValue": 1,
                "outputText": "",
                "enabled": true,
            }],
            "binding": { "mode": "None" },
        })
    },
    normalize: |params| {
        super::round_trip_params::<TriggerParams>(params, &[]);
    },
    ports: trigger_ports,
    lower: |params, _| {
        let parsed: TriggerParams =
            serde_json::from_value(params.clone()).map_err(|e| e.to_string())?;
        Ok(crate::kind::NodeKind::Trigger {
            mode: parsed.mode,
            edge: match parsed.edge {
                TriggerEdge::Level => "level".to_owned(),
                TriggerEdge::Rising => "rising".to_owned(),
            },
            default_miss: parsed.default_miss as f32,
            default_miss_text: parsed.default_miss_text,
            command: parsed.command,
            rules: parsed
                .rules
                .into_iter()
                .map(|rule| {
                    serde_json::from_value(json!({
                        "id": rule.id, "pattern": rule.pattern,
                        "match_type": rule.match_type, "flags": rule.flags,
                        "output_type": rule.output_type, "output_value": rule.output_value,
                        "output_text": rule.output_text, "enabled": rule.enabled,
                    }))
                    .expect("trigger rule wire is well-formed")
                })
                .collect(),
        })
    },
};

pub(super) static TRIGGER: WidgetDefinition = TRIGGER_DEF;

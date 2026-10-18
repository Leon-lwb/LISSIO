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

use data_model::panel_descriptor::{PanelDelivery, PanelKind, panel_ops};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::WidgetDefinition;
use super::WidgetPortTable;
use super::params::{f32_port, string_port};
use super::{PanelBindingSpec, PanelSpec};

/// 匹配类型 — 唯一 Rust 声明在 `trigger` crate, 本模块只转发 (cc `kind::widgets`)。
pub use trigger::TriggerMatchType;
use trigger::TriggerRuleDef;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct TriggerRule {
    pub id: String,
    #[serde(default)]
    pub pattern: String,
    #[serde(default)]
    pub match_type: TriggerMatchType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flags: Option<String>,
    #[serde(default)]
    pub output_type: TriggerOutputType,
    #[serde(default)]
    pub output_value: f64,
    #[serde(default)]
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

/// 控件参数规则 → 图侧规则 (`NodeKind::Trigger.rules`) 的转换错误。
///
/// 取代旧的 `serde_json::from_value(..).expect(..)`: 转换是一个纯字段映射,
/// 唯一可能失败的是超出 f32 表示范围的数值, 这里返回错误而不是 panic。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TriggerRuleError {
    field: &'static str,
}

impl TriggerRuleError {
    const fn new(field: &'static str) -> Self {
        Self { field }
    }
}

impl std::fmt::Display for TriggerRuleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "trigger rule `{}` is outside the f32 range of the graph evaluation plane",
            self.field
        )
    }
}

impl std::error::Error for TriggerRuleError {}

/// 收窄 f64 (JS number, 控件参数) → f32 (图数值平面, 端口与求值)。
///
/// 收窄是有意的: `TriggerParams` 用 f64 承接前端 JSON number, 而图求值、端口
/// 槽位与 `TriggerRuleDef` 全是 f32, 跨界只在这里发生一次。有限值一旦放大到
/// f32 之外 (`±inf`) 即报错 — 静默变成 inf 会让规则输出与用户输入不一致。
const fn narrow_to_f32(field: &'static str, value: f64) -> Result<f32, TriggerRuleError> {
    let narrowed = value as f32;
    if value.is_finite() != narrowed.is_finite() {
        return Err(TriggerRuleError::new(field));
    }
    Ok(narrowed)
}

/// 控件参数规则 → 图侧规则 — 直接字段映射, 不经 `serde_json`, 不 panic。
impl TryFrom<&TriggerRule> for TriggerRuleDef {
    type Error = TriggerRuleError;

    fn try_from(rule: &TriggerRule) -> Result<Self, Self::Error> {
        Ok(Self {
            id: rule.id.clone(),
            pattern: rule.pattern.clone(),
            match_type: rule.match_type,
            flags: rule.flags.clone(),
            output_type: match rule.output_type {
                TriggerOutputType::Number => "number",
                TriggerOutputType::String => "string",
            }
            .to_owned(),
            output_value: narrow_to_f32("outputValue", rule.output_value)?,
            output_text: rule.output_text.clone(),
            enabled: rule.enabled,
        })
    }
}

/// 归一化 `binding` 到 serde 形状 (与 Radio/Checkbox 的归一化同形)。
///
/// 前端 `WidgetBinding` 与目录默认值发来的是小写 `{"mode": ...}`, 而
/// [`InputBinding`](super::params::InputBinding) 的 serde 形状是 PascalCase
/// (`{"Mode": ...}`)。Trigger 的 `normalize` 只做结构 round-trip, 不先归一化
/// binding 就会解析失败 — 于是 `lower` 报 "missing field `Mode`", 控件无法上图。
///
/// 已含 `Mode` 的值原样保留: `normalize_binding` 只认小写形态, 重复调用会把
/// 真实绑定抹成 None。
fn canonicalize_binding(params: &mut Value) {
    let already_canonical = params
        .get("binding")
        .is_some_and(|binding| binding.get("Mode").is_some());
    if already_canonical {
        return;
    }
    let Some(binding) = params.get("binding") else {
        return;
    };
    let Ok(wire) = serde_json::to_value(super::params::normalize_binding(binding)) else {
        return;
    };
    if let Some(object) = params.as_object_mut() {
        object.insert("binding".to_owned(), wire);
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
        canonicalize_binding(params);
        super::round_trip_params::<TriggerParams>(params);
    },
    ports: trigger_ports,
    lower: |params, _| {
        let parsed: TriggerParams =
            serde_json::from_value(params.clone()).map_err(|e| e.to_string())?;
        let default_miss =
            narrow_to_f32("defaultMiss", parsed.default_miss).map_err(|e| e.to_string())?;
        let rules = parsed
            .rules
            .iter()
            .map(TriggerRuleDef::try_from)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(crate::kind::NodeKind::Trigger {
            mode: parsed.mode,
            edge: match parsed.edge {
                TriggerEdge::Level => "level".to_owned(),
                TriggerEdge::Rising => "rising".to_owned(),
            },
            default_miss,
            default_miss_text: parsed.default_miss_text,
            command: parsed.command,
            rules,
        })
    },
    // 触发器面板: 结果读自后端图输出 (value/matched 数值平面, text 字符串平面),
    // 实时值走 port_samples, 一次性读取走 graphOutputs 快照。
    panel: Some(PanelSpec {
        panel: PanelKind::Trigger,
        tab_type: "trigger",
        label_key: "dataTabTrigger",
        delivery: PanelDelivery::Both,
        push_request: Some(panel_ops::PUSH_PORT_SAMPLES),
        fetch_op: Some(panel_ops::FETCH_GRAPH_OUTPUTS),
        binding: PanelBindingSpec::EdgeBound,
        default_interval_ms: Some(33),
        default_max_items: None,
    }),
};

pub(super) static TRIGGER: WidgetDefinition = TRIGGER_DEF;

#[cfg(test)]
#[path = "trigger_tests.rs"]
mod tests;

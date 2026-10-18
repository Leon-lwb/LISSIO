//! 触发器公共类型 — 与前端 `TriggerRule` / `TriggerMatchResult` 对齐

use serde::{Deserialize, Serialize};

/// 匹配类型 — 与前端 `TriggerMatchType` 对齐。
///
/// 全仓唯一的 Rust 声明: `kind::widgets::TriggerMatchType` 只是本类型的转发
/// (`kind` 依赖 `trigger`), 不再各自定义一份。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize, ts_rs::TS)]
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

/// 单条匹配规则 — 前端 `TriggerRule` 的图侧形状 (`NodeKind::Trigger.rules`)。
///
/// camelCase 与其余 wire DTO 一致; 控件参数 (`kind::widgets::TriggerRule`) 经
/// `TryFrom<&TriggerRule>` 直接转换成本类型, 不再走 `serde_json` 往返。
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct TriggerRuleDef {
    pub id: String,
    pub pattern: String,
    pub match_type: TriggerMatchType,
    #[serde(default)]
    pub flags: Option<String>,
    /// 输出值类型: 'number' | 'string' (默认 'number')
    #[serde(default = "default_output_type")]
    pub output_type: String,
    /// 数字输出值 (output_type='number' 时使用)
    #[serde(default)]
    pub output_value: f32,
    /// 字符串输出值 (output_type='string' 时使用)
    #[serde(default)]
    pub output_text: String,
    pub enabled: bool,
}

fn default_output_type() -> String {
    "number".to_string()
}

/// 匹配结果 — 返回前端 (camelCase, 对齐前端 TriggerMatchResult 类型)
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct TriggerMatchResult {
    pub value: f32,
    pub matched: bool,
    /// 字符串输出 (output_type='string' 时填充规则 output_text, 否则 default_miss_text)
    pub text: String,
    /// 本次匹配的输出类型: 'number' | 'string' | 'miss'
    pub output_type: String,
}

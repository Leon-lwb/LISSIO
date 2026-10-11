//! 控件共享参数结构 — 默认工厂 / 归一化 / 端口解析 / lowering 共用。
//!
//! serde 形状与前端 `src/types/widgets.ts` 的 params 逐字一致 (camelCase)。
//! 所有字段 `#[serde(default)]` — 缺省字段落默认值, 这是归一化的
//! "补齐" 一半; 校验部分在各控件定义的 normalize 函数里 (Value 层)。

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
use serde_json::Value;

use super::WidgetPort;

// ============ 输入绑定 ============

/// 输入控件 → 传输通道的绑定 (与前端 WidgetBinding 对应)。
/// 旧版绑定没有明确目标时归一化为 None — 宁可禁用, 不能静默发错设备。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "PascalCase")]
pub struct InputBinding {
    pub mode: BindingMode,
    #[serde(default)]
    pub params: Option<BindingParams>,
}

impl InputBinding {
    pub fn none() -> Self {
        Self::default()
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "PascalCase")]
pub enum BindingMode {
    #[default]
    None,
    Auto,
    Manual,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct BindingParams {
    #[serde(default)]
    pub transport_id: String,
    #[serde(default)]
    pub protocol_id: String,
    /// Auto: 数值通道 (≥0)
    #[serde(default)]
    pub channel: i64,
    /// Manual: 字符串模板 ("{value}")
    #[serde(default)]
    pub template: String,
}

/// 归一化 binding — 非法/旧形态一律退回 None。
pub fn normalize_binding(value: &Value) -> InputBinding {
    let Some(mode) = value.get("mode").and_then(Value::as_str) else {
        return InputBinding::none();
    };
    let params = value.get("params");
    match mode {
        "Auto" => {
            let transport_id = string_field(params, "transportId");
            let protocol_id = string_field(params, "protocolId");
            if transport_id.is_empty() || protocol_id.is_empty() {
                return InputBinding::none();
            }
            let channel = params
                .and_then(|p| p.get("channel"))
                .and_then(Value::as_i64)
                .unwrap_or(0)
                .max(0);
            InputBinding {
                mode: BindingMode::Auto,
                params: Some(BindingParams {
                    transport_id,
                    protocol_id,
                    channel,
                    template: String::new(),
                }),
            }
        }
        "Manual" => {
            let transport_id = string_field(params, "transportId");
            if transport_id.is_empty() {
                return InputBinding::none();
            }
            let mut template = string_field(params, "template");
            if template.is_empty() {
                // Manual 绑定的默认插值模板 (含 "{value}" 占位, 非 format 参数)
                #[allow(clippy::literal_string_with_formatting_args)]
                let default_template = "{value}";
                template = String::from(default_template);
            }
            InputBinding {
                mode: BindingMode::Manual,
                params: Some(BindingParams {
                    transport_id,
                    protocol_id: String::new(),
                    channel: 0,
                    template,
                }),
            }
        }
        _ => InputBinding::none(),
    }
}

fn string_field(value: Option<&Value>, key: &str) -> String {
    value
        .and_then(|v| v.get(key))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

// ============ 选项 (Radio/Checkbox) ============

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceOption {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub value: f64,
}

// ============ 显示量程 ============

pub const DEFAULT_DISPLAY_MIN: f64 = 0.0;
pub const DEFAULT_DISPLAY_MAX: f64 = 100.0;
pub const DEFAULT_DISPLAY_WINDOW_SEC: f64 = 10.0;
pub const DEFAULT_DISPLAY_MAJOR_TICKS: i64 = 5;

/// 刻度/读数小数位; 'auto' = 由刻度间距推导
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(untagged)]
pub enum DisplayPrecision {
    Auto(String),
    Fixed(f64),
}

impl Default for DisplayPrecision {
    fn default() -> Self {
        Self::Auto("auto".to_owned())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct DisplayRange {
    pub mode: DisplayRangeMode,
    pub min: f64,
    pub max: f64,
    /// auto 模式滑动窗口 (秒)
    pub window_sec: f64,
    /// 主刻度标签数 (含两端), 钳制 2..11
    pub major_ticks: i64,
    pub precision: DisplayPrecision,
}

impl Default for DisplayRange {
    fn default() -> Self {
        Self {
            mode: DisplayRangeMode::Manual,
            min: DEFAULT_DISPLAY_MIN,
            max: DEFAULT_DISPLAY_MAX,
            window_sec: DEFAULT_DISPLAY_WINDOW_SEC,
            major_ticks: DEFAULT_DISPLAY_MAJOR_TICKS,
            precision: DisplayPrecision::default(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum DisplayRangeMode {
    #[default]
    Manual,
    Auto,
}

// ============ Model3D ============

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct Model3DSource {
    pub kind: Model3DSourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum Model3DSourceKind {
    #[serde(rename = "builtin-cube")]
    BuiltinCube,
    Custom,
}

// ============ 端口构造 ============

pub fn f32_port(handle: impl Into<String>) -> WidgetPort {
    WidgetPort::new(handle, crate::ports::PortDomain::F32)
}

pub fn string_port(handle: impl Into<String>) -> WidgetPort {
    WidgetPort::new(handle, crate::ports::PortDomain::String)
}

pub fn bytes_port(handle: impl Into<String>) -> WidgetPort {
    WidgetPort::new(handle, crate::ports::PortDomain::Bytes)
}

pub fn spectrum_port(handle: impl Into<String>) -> WidgetPort {
    WidgetPort::new(handle, crate::ports::PortDomain::Spectrum)
}

// ============ 数值工具 (与前端 numericControl.ts 对齐) ============

const MAX_DECIMALS: u32 = 10;

pub(super) const fn finite_or(value: Option<f64>, fallback: f64) -> f64 {
    match value {
        Some(v) if v.is_finite() => v,
        _ => fallback,
    }
}

/// 与前端 `snapControlValue` 一致: 把 value 吸附到 [min, max] 的 step 网格上。
pub fn snap_control_value(value: f64, min: f64, max: f64, step: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    if !min.is_finite() || !max.is_finite() || !step.is_finite() || min >= max || step <= 0.0 {
        return value;
    }
    let precision = MAX_DECIMALS.min(
        decimal_places(min)
            .max(decimal_places(step))
            .max(decimal_places(value))
            .max(decimal_places(max)),
    );
    let factor = 10_f64.powi(precision as i32);
    let scaled_min = (min * factor).round();
    let scaled_max = (max * factor).round();
    let scaled_step = (step * factor).round().max(1.0);
    let scaled_value = (value * factor).round();
    let snapped = scaled_min + ((scaled_value - scaled_min) / scaled_step).round() * scaled_step;
    let clamped = snapped.max(scaled_min).min(scaled_max);
    let rounded = clamped / factor;
    if rounded == 0.0 && rounded.is_sign_negative() {
        0.0
    } else {
        rounded
    }
}

fn decimal_places(value: f64) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    // 与前端 to_string 路径一致的最短表示小数位
    let text = format!("{value}");
    let text = text.trim_start_matches('-');
    if let Some((_, fraction)) = text.split_once('.') {
        fraction.len() as u32
    } else {
        0
    }
}

#[cfg(test)]
#[path = "params_tests.rs"]
mod tests;

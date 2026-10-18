//! 控件定义注册表 — 每个稳定 widgetKind 绑定描述、默认工厂、归一化、端口与
//! lowering 的单一权威。目录 (WP: 模型目录) 从这里投影 ModelDescriptor,
//! 文档准备/描述与图提交复用同一注册表; 前端不再维护业务白名单。
//!
//! wire 外形不变: `NodeBusiness::Widget` 仍是 `widgetKind` 字符串 + JSON params。
//! params 的业务结构在 `params.rs` 建模并解码; UI 私有字段 (如块 label) 由
//! 归一化保留在原样 Value 上。

mod command;
mod controls;
mod custom;
mod decoder;
mod display_normalize;
mod display_params;
mod displays;
mod math_text;
mod panel_spec;
mod params;
mod signal;
mod trigger;

use serde_json::Value;

use crate::document::CustomPorts;
use crate::kind::NodeKind;
use crate::ports::PortDomain;

/// 一个控件端口 — handle + 展示标签 + 数据域。
/// handle 决定连线; label 仅用于展示 (PieChart 的 label 是扇区名)。
#[derive(Clone, Debug, PartialEq, Eq, ts_rs::TS)]
pub struct WidgetPort {
    pub handle: String,
    pub label: String,
    pub domain: PortDomain,
}

impl WidgetPort {
    pub fn new(handle: impl Into<String>, domain: PortDomain) -> Self {
        let handle = handle.into();
        Self {
            label: handle.clone(),
            handle,
            domain,
        }
    }

    pub fn labeled(
        handle: impl Into<String>,
        label: impl Into<String>,
        domain: PortDomain,
    ) -> Self {
        let handle = handle.into();
        Self {
            handle,
            label: label.into(),
            domain,
        }
    }
}

/// 一个控件按其 params 解析出的端口表。
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct WidgetPortTable {
    pub inputs: Vec<WidgetPort>,
    pub outputs: Vec<WidgetPort>,
}

/// 控件目录类别 — 数据键, 前端调色板按它分组/配色。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WidgetCategory {
    Controls,
    Displays,
    Math,
    Text,
    Command,
    Decoder,
    Custom,
}

impl WidgetCategory {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Controls => "controls",
            Self::Displays => "displays",
            Self::Math => "math",
            Self::Text => "text",
            Self::Command => "command",
            Self::Decoder => "decoder",
            Self::Custom => "custom",
        }
    }
}

/// 注册表条目: 一个稳定 widgetKind 的全部业务语义。
/// `node_id` 驱动的默认工厂保证子 ID (option/frame/rule) 确定性 —
/// 同一 nodeId 重复请求产生完全相同的默认文档。
pub struct WidgetDefinition {
    /// 稳定 wire kind (NodeBusiness::Widget.widgetKind), 例如 "Knob"。
    pub kind: &'static str,
    pub category: WidgetCategory,
    /// 前端 UI registry 的 renderer/editor 数据键; 与 kind 同名。
    pub renderer_key: &'static str,
    /// 目录/描述用的稳定 fallback label (翻译仍在前端)。
    pub fallback_label: &'static str,
    /// 无实例 ID 的默认 params 预览 (id/label 由 node_id 派生)。
    pub default_params: fn(node_id: &str) -> Value,
    /// 原地归一化: 补齐缺省 + 校验; 幂等。
    pub normalize: fn(params: &mut Value),
    /// 按当前 params 解析完整端口表。
    pub ports: fn(params: &Value) -> WidgetPortTable,
    /// params → 图语义 (widget_document::lower 委托这里)。
    pub lower: fn(params: &Value, custom_ports: Option<&CustomPorts>) -> Result<NodeKind, String>,
    /// 数据面板规格 — `None` 表示该控件不是可独立开窗的数据面板。
    ///
    /// 面板语义 (tab 类型 / 数据面投递 / 输入绑定) 与控件定义同处声明,
    /// 避免第二张平行表; 目录投影见 `app::models::catalog`。
    pub panel: Option<PanelSpec>,
}

impl WidgetDefinition {
    /// 确定性默认 params: 子 ID 全部由 node_id 派生。
    pub fn default_params(&self, node_id: &str) -> Value {
        (self.default_params)(node_id)
    }

    pub fn normalize(&self, params: &mut Value) {
        (self.normalize)(params);
    }

    pub fn ports(&self, params: &Value) -> WidgetPortTable {
        (self.ports)(params)
    }
}

/// 全部已注册控件定义, 稳定顺序 (按类别, 类别内按目录排序值)。
// ---- 参数结构再导出 (wire 合同 + TS 生成) ----
pub use command::{CommandBlock, CommandBlockType, CommandFrame, CommandParams, CommandSendMode};
pub use controls::{ButtonParams, CheckboxParams, KnobParams, RadioParams, SliderParams};
pub use decoder::FrameDecoderParams;
pub use display_params::{
    GaugeParams, ImageFormat, ImageParams, LabelParams, LedParams, Model3DAttitudeInputMode,
    Model3DMode, Model3DParams, NumberDisplayParams, PieChartParams, ProgressOrientation,
    ProgressParams, RawDataParams, SpectrumParams, TableViewColumn, TableViewParams,
    WaveformParams,
};
pub use panel_spec::{PanelBindingSpec, PanelSpec, SHELL_TAB_TYPES};
pub use params::{
    BindingMode, BindingParams, ChoiceOption, DisplayPrecision, DisplayRange, DisplayRangeMode,
    InputBinding,
};
pub use params::{Model3DSource, Model3DSourceKind};
pub use trigger::{
    TriggerEdge, TriggerMatchType, TriggerOutputType, TriggerParams, TriggerRule, TriggerRuleError,
};

pub fn definitions() -> impl Iterator<Item = &'static WidgetDefinition> {
    DEFINITIONS.iter().copied()
}

static DEFINITIONS: &[&WidgetDefinition] = &[
    // ---- controls ----
    &controls::KNOB,
    &controls::SLIDER,
    &controls::BUTTON,
    &controls::RADIO,
    &controls::CHECKBOX,
    // ---- math ----
    &math_text::MATH,
    &signal::FILTER,
    &signal::FFT,
    &signal::IFFT,
    // ---- text ----
    &math_text::STR,
    &math_text::TEXT_INPUT,
    &math_text::TEXT_DISPLAY,
    &math_text::TEXT_OUT,
    // ---- displays ----
    &displays::LABEL,
    &displays::GAUGE,
    &displays::PROGRESS,
    &displays::LED,
    &displays::NUMBER_DISPLAY,
    &displays::PIE_CHART,
    &displays::IMAGE,
    &displays::WAVEFORM,
    &displays::SPECTRUM,
    &displays::MODEL3D,
    &displays::TABLE_VIEW,
    // ---- command / decoder / custom / trigger ----
    &command::COMMAND,
    &decoder::FRAME_DECODER,
    &trigger::TRIGGER,
    &custom::CUSTOM,
    &displays::RAW_DATA,
];

/// 按 wire kind 查找定义。
pub fn definition(kind: &str) -> Option<&'static WidgetDefinition> {
    definitions().find(|def| def.kind == kind)
}

/// 注册表完整性: id 唯一 + renderer_key 与 kind 同名 + 面板规格自洽。
/// 组合根启动时调用; 失败即启动失败 (而不是静默丢语义)。
pub fn ensure_valid() -> Result<(), String> {
    let defs = definitions().collect::<Vec<_>>();
    for (index, def) in defs.iter().enumerate() {
        if defs[index + 1..].iter().any(|other| other.kind == def.kind) {
            return Err(format!("duplicate widget definition: {}", def.kind));
        }
        if def.renderer_key != def.kind {
            return Err(format!(
                "renderer_key must equal kind: {} != {}",
                def.renderer_key, def.kind
            ));
        }
        if let Some(panel) = &def.panel {
            panel_spec::validate(panel, def.kind)?;
        }
    }
    Ok(())
}

/// 归一化入口 — id/label 注入 + 按注册定义委托。
///
/// label 缺省使用稳定 fallback (Label 用 text); 之后切换语言不重写
/// 用户名称 (label 一旦非空即保留)。
pub fn normalize_params(kind: &str, params: &mut Value) -> Result<(), String> {
    let def = definition(kind).ok_or_else(|| format!("unknown widget kind: {kind}"))?;
    if !params.is_object() {
        *params = serde_json::json!({});
    }
    let object = params.as_object_mut().expect("checked above");
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let raw_label = object
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let fallback = if def.kind == "Label" {
        object
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or(def.fallback_label)
            .to_owned()
    } else {
        def.fallback_label.to_owned()
    };
    let label = if raw_label.trim().is_empty() {
        fallback
    } else {
        raw_label
    };
    (def.normalize)(params);
    let object = params.as_object_mut().expect("normalize keeps object");
    object.insert("id".into(), Value::String(id));
    object.insert("label".into(), Value::String(label));
    Ok(())
}

/// 端口解析 — 未知 kind 返回 None (调用方决定如何呈现 unsupported,
/// 不能冒充权威空表)。
pub fn ports_for(kind: &str, params: &Value) -> Option<WidgetPortTable> {
    let def = definition(kind)?;
    Some((def.ports)(params))
}

/// lowering — widget_document::lower 委托注册定义。
pub fn lower(
    kind: &str,
    params: &Value,
    custom_ports: Option<&CustomPorts>,
) -> Result<NodeKind, String> {
    let def = definition(kind).ok_or_else(|| format!("unknown widget kind: {kind}"))?;
    (def.lower)(params, custom_ports)
}

/// 结构 round-trip: params → T (补默认) → wire Value (+保留未知键, 避免丢数据)。
pub(crate) fn round_trip_params<T: serde::de::DeserializeOwned + serde::Serialize>(
    params: &mut Value,
) {
    if let Ok(parsed) = serde_json::from_value::<T>(params.clone())
        && let Ok(mut wire) = serde_json::to_value(&parsed)
    {
        merge_unknown(params, &mut wire);
        *params = wire;
    }
}

pub(crate) fn merge_unknown(original: &Value, wire: &mut Value) {
    let (Some(orig), Some(out)) = (original.as_object(), wire.as_object_mut()) else {
        return;
    };
    for (key, value) in orig {
        if !out.contains_key(key) {
            out.insert(key.clone(), value.clone());
        }
    }
}

#[cfg(test)]
mod tests;

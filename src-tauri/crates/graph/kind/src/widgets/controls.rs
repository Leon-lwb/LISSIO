//! 输入控件 (Knob/Slider/Button/Radio/Checkbox) — 默认、归一化、端口与 lowering。
//!
//! 归一化移植自前端 `widgetNormalize.ts`: 旧形态 (snake_case 值字段、选项数组
//! 元组、legacy default 索引) 迁移为当前模型; 幂等。

// 数值转换均为有界索引/精度语义 (JSON number <-> 定宽整数), 与前端 JS 数值
// 行为对齐; 此处统一豁免逐个标注的噪音。
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::suboptimal_flops
)]

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::params::{ChoiceOption, InputBinding, finite_or, normalize_binding, snap_control_value};
use super::{WidgetDefinition, WidgetPortTable, merge_unknown};

// ============ 参数结构 ============

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct KnobParams {
    pub id: String,
    pub label: String,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub value: f64,
    pub binding: InputBinding,
}

impl Default for KnobParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            min: 0.0,
            max: 100.0,
            step: 1.0,
            value: 50.0,
            binding: InputBinding::none(),
        }
    }
}

/// Slider 与 Knob 参数同形 — 复用结构, wire 上无 kind 字段不区分。
pub type SliderParams = KnobParams;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct ButtonParams {
    pub id: String,
    pub label: String,
    #[serde(alias = "press_value")]
    pub press_value: f64,
    #[serde(alias = "release_value")]
    pub release_value: f64,
    pub binding: InputBinding,
}

impl Default for ButtonParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            press_value: 1.0,
            release_value: 0.0,
            binding: InputBinding::none(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct RadioParams {
    pub id: String,
    pub label: String,
    pub options: Vec<ChoiceOption>,
    pub selected_id: String,
    pub binding: InputBinding,
}

impl Default for RadioParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            options: Vec::new(),
            selected_id: String::new(),
            binding: InputBinding::none(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct CheckboxParams {
    pub id: String,
    pub label: String,
    pub options: Vec<ChoiceOption>,
    pub selected_ids: Vec<String>,
    /// 空选值; 0 时序列化省略 (与前端 `...(emptyValue === 0 ? {} : { emptyValue })` 对齐)
    #[serde(default, skip_serializing_if = "is_zero")]
    pub empty_value: f64,
    pub binding: InputBinding,
}

#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_zero(value: &f64) -> bool {
    *value == 0.0
}

impl Default for CheckboxParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            options: Vec::new(),
            selected_ids: Vec::new(),
            empty_value: 0.0,
            binding: InputBinding::none(),
        }
    }
}

// ============ 归一化 ============

/// Knob/Slider 共用: 量程吸附 + 绑定。旧值字段无别名 (min/max/step/value 拼写未变)。
fn normalize_range_like<T: RangeLikeParams + DeserializeOwned + Serialize>(params: &mut Value) {
    if let Ok(mut parsed) = serde_json::from_value::<T>(params.clone()) {
        let (min, max, step) = (parsed.min(), parsed.max(), parsed.step());
        parsed.set_value(snap_control_value(parsed.value(), min, max, step));
        if let Ok(mut wire) = serde_json::to_value(&parsed) {
            merge_unknown(params, &mut wire, &[]);
            *params = wire;
        }
    }
}

/// 量程参数的读取/写入抽象 (Knob 与 Slider 同形)。
trait RangeLikeParams {
    fn min(&self) -> f64;
    fn max(&self) -> f64;
    fn step(&self) -> f64;
    fn value(&self) -> f64;
    fn set_value(&mut self, value: f64);
}

impl RangeLikeParams for KnobParams {
    fn min(&self) -> f64 {
        self.min
    }
    fn max(&self) -> f64 {
        self.max
    }
    fn step(&self) -> f64 {
        self.step
    }
    fn value(&self) -> f64 {
        self.value
    }
    fn set_value(&mut self, value: f64) {
        self.value = value;
    }
}

fn normalize_knob(params: &mut Value) {
    normalize_range_like::<KnobParams>(params);
}

fn normalize_button(params: &mut Value) {
    if let Ok(mut wire) = serde_json::from_value::<ButtonParams>(params.clone())
        .and_then(|parsed| serde_json::to_value(&parsed))
    {
        merge_unknown(params, &mut wire, &["press_value", "release_value"]);
        *params = wire;
    }
}

/// 选项数组迁移: 元组 `[label, value]` / 缺 id 的对象 → 当前形态。
fn normalize_options(value: &Value, widget_id: &str) -> Vec<ChoiceOption> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            if let Some(pair) = item.as_array() {
                let label = pair
                    .first()
                    .and_then(Value::as_str)
                    .map_or_else(|| format!("Option {}", index + 1), str::to_owned);
                let option_value = finite_or(pair.get(1).and_then(Value::as_f64), index as f64);
                return Some(ChoiceOption {
                    id: format!("{widget_id}-option-{}", index + 1),
                    label,
                    value: option_value,
                });
            }
            let option = item.as_object()?;
            if option.is_empty() {
                return None;
            }
            let id = match option.get("id").and_then(Value::as_str) {
                Some(id) if !id.is_empty() => id.to_owned(),
                _ => format!("{widget_id}-option-{}", index + 1),
            };
            let label = match option.get("label").and_then(Value::as_str) {
                Some(label) if !label.trim().is_empty() => label.to_owned(),
                _ => format!("Option {}", index + 1),
            };
            Some(ChoiceOption {
                id,
                label,
                value: finite_or(option.get("value").and_then(Value::as_f64), index as f64),
            })
        })
        .collect()
}

fn normalize_radio(params: &mut Value) {
    let id = params
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let options = normalize_options(params.get("options").unwrap_or(&Value::Null), &id);
    let safe_options: Vec<ChoiceOption> = if options.is_empty() {
        vec![ChoiceOption {
            id: format!("{id}-option-1"),
            label: "Option 1".into(),
            value: 0.0,
        }]
    } else {
        options
    };
    let legacy_index = finite_or(params.get("default").and_then(Value::as_f64), 0.0)
        .max(0.0)
        .trunc() as usize;
    let requested_id = params
        .get("selectedId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let selected_id = if safe_options.iter().any(|o| o.id == requested_id) {
        requested_id.to_owned()
    } else {
        safe_options
            .get(legacy_index)
            .or_else(|| safe_options.first())
            .map(|o| o.id.clone())
            .unwrap_or_default()
    };
    let binding = normalize_binding(params.get("binding").unwrap_or(&Value::Null));
    if let Ok(mut wire) = serde_json::to_value(&RadioParams {
        id,
        label: String::new(),
        options: safe_options,
        selected_id,
        binding,
    }) {
        merge_unknown(params, &mut wire, &["default"]);
        *params = wire;
    }
}

fn normalize_checkbox(params: &mut Value) {
    let id = params
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let is_legacy = params.get("checked_value").is_some()
        || params.get("unchecked_value").is_some()
        || params.get("default").is_some();
    let options = if is_legacy {
        vec![ChoiceOption {
            id: format!("{id}-option-1"),
            label: "Option 1".into(),
            value: finite_or(params.get("checked_value").and_then(Value::as_f64), 1.0),
        }]
    } else {
        normalize_options(params.get("options").unwrap_or(&Value::Null), &id)
    };
    let safe_options: Vec<ChoiceOption> = if options.is_empty() {
        vec![ChoiceOption {
            id: format!("{id}-option-1"),
            label: "Option 1".into(),
            value: 1.0,
        }]
    } else {
        options
    };
    let valid_ids: std::collections::BTreeSet<&str> =
        safe_options.iter().map(|o| o.id.as_str()).collect();
    let selected_ids: Vec<String> = if is_legacy {
        if params.get("default") == Some(&Value::Bool(true)) {
            vec![safe_options[0].id.clone()]
        } else {
            Vec::new()
        }
    } else {
        params
            .get("selectedIds")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|id| valid_ids.contains(*id))
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    };
    let empty_value = if is_legacy {
        finite_or(params.get("unchecked_value").and_then(Value::as_f64), 0.0)
    } else {
        finite_or(params.get("emptyValue").and_then(Value::as_f64), 0.0)
    };
    let binding = normalize_binding(params.get("binding").unwrap_or(&Value::Null));
    if let Ok(mut wire) = serde_json::to_value(&CheckboxParams {
        id,
        label: String::new(),
        options: safe_options,
        selected_ids,
        empty_value,
        binding,
    }) {
        merge_unknown(
            params,
            &mut wire,
            &["checked_value", "unchecked_value", "default"],
        );
        *params = wire;
    }
}

// ============ 端口 ============

fn input_control_ports(_params: &Value) -> WidgetPortTable {
    WidgetPortTable {
        inputs: Vec::new(),
        outputs: vec![super::params::f32_port("value")],
    }
}

// ============ 定义 ============

const KNOB_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Knob",
    category: super::WidgetCategory::Controls,
    renderer_key: "Knob",
    fallback_label: "Knob",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Knob",
            "min": 0, "max": 100, "step": 1, "value": 50,
            "binding": { "mode": "None" },
        })
    },
    normalize: normalize_knob,
    ports: input_control_ports,
    lower: |_, _| Ok(crate::kind::NodeKind::Input),
};

const SLIDER_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Slider",
    category: super::WidgetCategory::Controls,
    renderer_key: "Slider",
    fallback_label: "Slider",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Slider",
            "min": 0, "max": 100, "step": 1, "value": 50,
            "binding": { "mode": "None" },
        })
    },
    normalize: normalize_knob,
    ports: input_control_ports,
    lower: |_, _| Ok(crate::kind::NodeKind::Input),
};

const BUTTON_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Button",
    category: super::WidgetCategory::Controls,
    renderer_key: "Button",
    fallback_label: "Button",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Button",
            "pressValue": 1, "releaseValue": 0,
            "binding": { "mode": "None" },
        })
    },
    normalize: normalize_button,
    ports: input_control_ports,
    lower: |_, _| Ok(crate::kind::NodeKind::Input),
};

const RADIO_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Radio",
    category: super::WidgetCategory::Controls,
    renderer_key: "Radio",
    fallback_label: "Radio",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Radio",
            "options": [
                { "id": format!("{node_id}-option-a"), "label": "A", "value": 0 },
                { "id": format!("{node_id}-option-b"), "label": "B", "value": 1 },
            ],
            "selectedId": format!("{node_id}-option-a"),
            "binding": { "mode": "None" },
        })
    },
    normalize: normalize_radio,
    ports: input_control_ports,
    lower: |_, _| Ok(crate::kind::NodeKind::Input),
};

const CHECKBOX_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Checkbox",
    category: super::WidgetCategory::Controls,
    renderer_key: "Checkbox",
    fallback_label: "Checkbox",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Checkbox",
            "options": [
                { "id": format!("{node_id}-option-a"), "label": "A", "value": 1 },
                { "id": format!("{node_id}-option-b"), "label": "B", "value": 2 },
            ],
            "selectedIds": [],
            "binding": { "mode": "None" },
        })
    },
    normalize: normalize_checkbox,
    ports: input_control_ports,
    lower: |_, _| Ok(crate::kind::NodeKind::Input),
};

pub(super) static KNOB: WidgetDefinition = KNOB_DEF;
pub(super) static SLIDER: WidgetDefinition = SLIDER_DEF;
pub(super) static BUTTON: WidgetDefinition = BUTTON_DEF;
pub(super) static RADIO: WidgetDefinition = RADIO_DEF;
pub(super) static CHECKBOX: WidgetDefinition = CHECKBOX_DEF;

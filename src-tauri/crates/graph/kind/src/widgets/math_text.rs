//! 运算与文本控件 — Math/Str/TextInput/TextDisplay/TextOut。
//!
//! Math/Str 的 op 元数据直接来自 `math_op.rs` / `str_op.rs` 的 Rust 定义
//! (一元性、输入端口数、输出域), 不再维护第二张前端表。

// 数值转换均为有界索引/精度语义 (JSON number <-> 定宽整数), 与前端 JS 数值
// 行为对齐; 此处统一豁免逐个标注的噪音。
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::suboptimal_flops
)]

use serde_json::{Value, json};

use super::WidgetDefinition;
use super::params::{f32_port, string_port};

fn parse_op<T: serde::de::DeserializeOwned>(value: Option<&Value>) -> Option<T> {
    serde_json::from_value(value.cloned()?).ok()
}

/// 与前端 `_UNARY_MATH_OPS` 一致的一元运算集合 — 输入端口数强制为 1。
pub const fn is_unary_math_op(op: crate::math_op::MathOp) -> bool {
    matches!(
        op,
        crate::math_op::MathOp::Abs
            | crate::math_op::MathOp::Neg
            | crate::math_op::MathOp::Square
            | crate::math_op::MathOp::Sqrt
            | crate::math_op::MathOp::Sin
            | crate::math_op::MathOp::Cos
            | crate::math_op::MathOp::Tan
            | crate::math_op::MathOp::Log
    )
}

pub(super) fn math_input_count(params: &Value) -> usize {
    let op = parse_op::<crate::math_op::MathOp>(params.get("op"));
    match op {
        Some(op) if is_unary_math_op(op) => 1,
        Some(_) => params
            .get("inputCount")
            .and_then(Value::as_i64)
            .map_or(2, |count| count.clamp(1, 8) as usize),
        None => 1,
    }
}

fn math_ports(params: &Value) -> super::WidgetPortTable {
    let inputs = (0..math_input_count(params))
        .map(|i| f32_port(format!("in{i}")))
        .collect();
    super::WidgetPortTable {
        inputs,
        outputs: vec![f32_port("result")],
    }
}

fn str_ports(params: &Value) -> super::WidgetPortTable {
    let Some(op) = parse_op::<crate::str_op::StrOp>(params.get("op")) else {
        return super::WidgetPortTable::default();
    };
    super::WidgetPortTable {
        inputs: op
            .input_ports()
            .iter()
            .map(|spec| super::WidgetPort::new(spec.handle, spec.domain))
            .collect(),
        outputs: vec![super::WidgetPort::new("result", op.output_domain())],
    }
}

fn text_in_ports(_params: &Value) -> super::WidgetPortTable {
    super::WidgetPortTable {
        inputs: Vec::new(),
        outputs: vec![string_port("str")],
    }
}

fn text_out_ports(_params: &Value) -> super::WidgetPortTable {
    super::WidgetPortTable {
        inputs: vec![string_port("text")],
        outputs: Vec::new(),
    }
}

pub(super) const MATH_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Math",
    category: super::WidgetCategory::Math,
    renderer_key: "Math",
    fallback_label: "Math",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Math",
            "op": "add", "inputCount": 2,
            "unit": "", "precision": 3,
        })
    },
    normalize: |params| {
        // 一元运算的 inputCount 强制 1 (lowering 同规则); 其余字段前端私有, 原样保留
        if parse_op::<crate::math_op::MathOp>(params.get("op")).is_some_and(is_unary_math_op)
            && let Some(object) = params.as_object_mut()
        {
            object.insert("inputCount".into(), json!(1));
        }
    },
    ports: math_ports,
    lower: |params, _| {
        let op: crate::math_op::MathOp = parse_op(params.get("op")).ok_or("math op required")?;
        let input_count = if is_unary_math_op(op) {
            1
        } else {
            params
                .get("inputCount")
                .and_then(Value::as_i64)
                .map(|count| count.clamp(1, 8) as usize)
                .ok_or("math inputCount required")?
        };
        Ok(crate::kind::NodeKind::Math { op, input_count })
    },
    panel: None,
};

pub(super) const STR_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Str",
    category: super::WidgetCategory::Text,
    renderer_key: "Str",
    fallback_label: "Str",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Str",
            "op": "len", "pos": 1, "len": 0, "size": 0, "tmpl": "",
        })
    },
    normalize: |params| {
        let _ = params;
    },
    ports: str_ports,
    lower: |params, _| {
        let op: crate::str_op::StrOp = parse_op(params.get("op")).ok_or("str op required")?;
        let get_num = |key: &str| {
            params
                .get(key)
                .and_then(Value::as_f64)
                .map_or(0.0_f32, |v| v as f32)
        };
        Ok(crate::kind::NodeKind::Str {
            op,
            num: crate::str_op::StrNumParams {
                pos: get_num("pos"),
                len: get_num("len"),
                size: get_num("size"),
            },
            tmpl: params
                .get("tmpl")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        })
    },
    panel: None,
};

pub(super) const TEXT_INPUT_DEF: WidgetDefinition = WidgetDefinition {
    kind: "TextInput",
    category: super::WidgetCategory::Text,
    renderer_key: "TextInput",
    fallback_label: "TextInput",
    default_params: |node_id| json!({ "id": node_id, "label": "TextInput", "text": "", "placeholder": "" }),
    normalize: |params| {
        // text 缺省补空串 (lowering 直接读取)
        if params.get("text").is_none()
            && let Some(object) = params.as_object_mut()
        {
            object.insert("text".into(), json!(""));
        }
    },
    ports: text_in_ports,
    lower: |params, _| {
        Ok(crate::kind::NodeKind::TextInput {
            text: params
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        })
    },
    panel: None,
};

pub(super) const TEXT_DISPLAY_DEF: WidgetDefinition = WidgetDefinition {
    kind: "TextDisplay",
    category: super::WidgetCategory::Text,
    renderer_key: "TextDisplay",
    fallback_label: "TextDisplay",
    default_params: |node_id| json!({ "id": node_id, "label": "TextDisplay", "fontSize": "base", "monospace": true }),
    normalize: |params| {
        let _ = params;
    },
    ports: text_out_ports,
    lower: |_, _| Ok(crate::kind::NodeKind::TextDisplay),
    panel: None,
};

pub(super) const TEXT_OUT_DEF: WidgetDefinition = WidgetDefinition {
    kind: "TextOut",
    category: super::WidgetCategory::Text,
    renderer_key: "TextOut",
    fallback_label: "TextOut",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "TextOut",
            "targetTransport": "", "newline": "none", "minIntervalMs": 50,
        })
    },
    normalize: |params| {
        let _ = params;
    },
    ports: text_out_ports,
    lower: |params, _| {
        Ok(crate::kind::NodeKind::TextOut {
            target_transport: params
                .get("targetTransport")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            newline: serde_json::from_value(
                params
                    .get("newline")
                    .cloned()
                    .unwrap_or_else(|| json!("none")),
            )
            .unwrap_or(crate::kind::NewlineMode::None),
            min_interval_ms: params
                .get("minIntervalMs")
                .and_then(Value::as_u64)
                .unwrap_or(50) as u32,
        })
    },
    panel: None,
};

pub(super) static MATH: WidgetDefinition = MATH_DEF;
pub(super) static STR: WidgetDefinition = STR_DEF;
pub(super) static TEXT_INPUT: WidgetDefinition = TEXT_INPUT_DEF;
pub(super) static TEXT_DISPLAY: WidgetDefinition = TEXT_DISPLAY_DEF;
pub(super) static TEXT_OUT: WidgetDefinition = TEXT_OUT_DEF;

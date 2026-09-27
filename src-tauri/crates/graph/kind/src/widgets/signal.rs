//! 信号求解控件 — Filter/FFT/IFFT。
//!
//! lowering 与 widget_document.rs 原实现一致: Filter 的 preset 归一为小写
//! (biquad 系数由后端 filter crate 派生, b/a 不经 IPC); FFT/IFFT 直接映射
//! `NodeKind::Fft`/`NodeKind::Ifft`。

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
use super::params::{f32_port, spectrum_port};

fn filter_ports(_params: &Value) -> super::WidgetPortTable {
    super::WidgetPortTable {
        inputs: vec![f32_port("in0")],
        outputs: vec![f32_port("result")],
    }
}

fn fft_ports(_params: &Value) -> super::WidgetPortTable {
    super::WidgetPortTable {
        inputs: vec![f32_port("in0")],
        outputs: vec![spectrum_port("spectrum")],
    }
}

fn ifft_ports(_params: &Value) -> super::WidgetPortTable {
    super::WidgetPortTable {
        inputs: vec![spectrum_port("spectrum")],
        outputs: vec![f32_port("out0")],
    }
}

pub(super) const FILTER_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Filter",
    category: super::WidgetCategory::Math,
    renderer_key: "Filter",
    fallback_label: "Filter",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Filter",
            "preset": "Lowpass", "cutoff": 100, "low": 80, "high": 200,
            "sampleRate": 1000, "precision": 3,
        })
    },
    normalize: |params| {
        let _ = params;
    },
    ports: filter_ports,
    lower: |params, _| {
        let preset = params
            .get("preset")
            .and_then(Value::as_str)
            .ok_or("filter preset required")?
            .to_lowercase();
        Ok(crate::kind::NodeKind::Filter {
            config: serde_json::from_value(json!({
                "preset": preset,
                "sample_rate": params.get("sampleRate").cloned().unwrap_or_else(|| json!(1000)),
                "cutoff": params.get("cutoff").cloned().unwrap_or_else(|| json!(100)),
                "low": params.get("low").cloned().unwrap_or_else(|| json!(80)),
                "high": params.get("high").cloned().unwrap_or_else(|| json!(200)),
            }))
            .map_err(|e| e.to_string())?,
        })
    },
    panel: None,
};

pub(super) const FFT_DEF: WidgetDefinition = WidgetDefinition {
    kind: "FFT",
    category: super::WidgetCategory::Math,
    renderer_key: "FFT",
    fallback_label: "FFT",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "FFT",
            "windowSize": 1024, "hopSize": 512,
            "windowType": "Hann", "output": "Magnitude", "sampleRate": 1000,
        })
    },
    normalize: |params| {
        let _ = params;
    },
    ports: fft_ports,
    lower: |params, _| {
        Ok(crate::kind::NodeKind::Fft {
            window_size: params
                .get("windowSize")
                .and_then(Value::as_u64)
                .unwrap_or(1024) as usize,
            hop_size: params.get("hopSize").and_then(Value::as_u64).unwrap_or(512) as usize,
            window_type: serde_json::from_value(
                params
                    .get("windowType")
                    .cloned()
                    .unwrap_or_else(|| json!("Hann")),
            )
            .map_err(|e| e.to_string())?,
            output: serde_json::from_value(
                params
                    .get("output")
                    .cloned()
                    .unwrap_or_else(|| json!("Magnitude")),
            )
            .map_err(|e| e.to_string())?,
            sample_rate: params
                .get("sampleRate")
                .and_then(Value::as_f64)
                .unwrap_or(1000.0) as f32,
        })
    },
    panel: None,
};

pub(super) const IFFT_DEF: WidgetDefinition = WidgetDefinition {
    kind: "IFFT",
    category: super::WidgetCategory::Math,
    renderer_key: "IFFT",
    fallback_label: "IFFT",
    default_params: |node_id| json!({ "id": node_id, "label": "IFFT" }),
    normalize: |params| {
        let _ = params;
    },
    ports: ifft_ports,
    lower: |_, _| Ok(crate::kind::NodeKind::Ifft),
    panel: None,
};

pub(super) static FILTER: WidgetDefinition = FILTER_DEF;
pub(super) static FFT: WidgetDefinition = FFT_DEF;
pub(super) static IFFT: WidgetDefinition = IFFT_DEF;

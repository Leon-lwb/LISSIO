//! 显示控件 — Label/Gauge/Progress/LED/NumberDisplay/PieChart/Image/Waveform/
//! Spectrum/Model3D/TableView/RawData。全部 lowering 为 Sink (纯展示, 无 f32
//! 输出); 端口按各自 params 解析 — 不是所有 Sink 共享一张端口表。

// 数值转换均为有界索引/精度语义 (JSON number <-> 定宽整数), 与前端 JS 数值
// 行为对齐; 此处统一豁免逐个标注的噪音。
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::suboptimal_flops
)]

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use super::display_normalize::{
    is_hex_color, normalize_display_range, normalize_gauge, normalize_model3d, normalize_progress,
    normalize_via,
};
use super::display_params::{
    GaugeParams, ImageFormat, ImageParams, LabelParams, LedParams, Model3DAttitudeInputMode,
    Model3DMode, Model3DParams, NumberDisplayParams, PieChartParams, ProgressOrientation,
    ProgressParams, RawDataParams, SpectrumParams, TableViewColumn, TableViewParams,
    WaveformParams,
};
use super::params::{DisplayRange, f32_port, finite_or};
use super::params::{Model3DSource, Model3DSourceKind};
use super::{WidgetDefinition, WidgetPortTable};

// ============ 端口 ============

fn value_input_ports(_params: &Value) -> WidgetPortTable {
    WidgetPortTable {
        inputs: vec![f32_port("value")],
        outputs: Vec::new(),
    }
}

fn pie_chart_ports(params: &Value) -> WidgetPortTable {
    let inputs = params
        .get("segments")
        .and_then(Value::as_array)
        .map(|segments| {
            segments
                .iter()
                .enumerate()
                .map(|(i, seg)| {
                    super::WidgetPort::labeled(
                        format!("seg{i}"),
                        seg.as_str().unwrap_or(""),
                        crate::ports::PortDomain::F32,
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    WidgetPortTable {
        inputs,
        outputs: Vec::new(),
    }
}

fn waveform_ports(params: &Value) -> WidgetPortTable {
    let channels = params
        .get("channels")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0) as usize;
    WidgetPortTable {
        inputs: (0..channels).map(|i| f32_port(format!("CH{i}"))).collect(),
        outputs: Vec::new(),
    }
}

fn spectrum_ports(_params: &Value) -> WidgetPortTable {
    WidgetPortTable {
        inputs: vec![super::params::spectrum_port("spectrum")],
        outputs: Vec::new(),
    }
}

fn model3d_ports(params: &Value) -> WidgetPortTable {
    let attitude_ids: &[&str] = match params.get("attitudeInputMode").and_then(Value::as_str) {
        Some("quaternion") => &["q0", "q1", "q2", "q3"],
        _ => &["roll", "pitch", "yaw"],
    };
    let attitude: Vec<super::WidgetPort> = attitude_ids.iter().map(|id| f32_port(*id)).collect();
    let mut inputs = vec![f32_port("x"), f32_port("y"), f32_port("z")];
    inputs.extend(attitude);
    WidgetPortTable {
        inputs,
        outputs: Vec::new(),
    }
}

fn raw_data_ports(_params: &Value) -> WidgetPortTable {
    // 静态端口 = 未连接时的单条回退口; 动态 src:* 端口由描述层按拓扑解析
    WidgetPortTable {
        inputs: vec![f32_port("data")],
        outputs: Vec::new(),
    }
}

fn no_ports(_params: &Value) -> WidgetPortTable {
    WidgetPortTable::default()
}

/// 历史默认分支: 单个 "in" 数值输入口 (未在端口表显式列出的显示控件)
fn single_in_ports(_params: &Value) -> WidgetPortTable {
    WidgetPortTable {
        inputs: vec![f32_port("in")],
        outputs: Vec::new(),
    }
}

// ============ 定义 ============

const fn sink_lower()
-> fn(&Value, Option<&crate::document::CustomPorts>) -> Result<crate::kind::NodeKind, String> {
    |_, _| Ok(crate::kind::NodeKind::Sink)
}

const LABEL_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Label",
    category: super::WidgetCategory::Displays,
    renderer_key: "Label",
    fallback_label: "Label",
    default_params: |node_id| json!({ "id": node_id, "label": "Label", "text": "Label", "channel": null }),
    normalize: normalize_via::<LabelParams>,
    ports: no_ports,
    lower: sink_lower(),
};

const GAUGE_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Gauge",
    category: super::WidgetCategory::Displays,
    renderer_key: "Gauge",
    fallback_label: "Gauge",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Gauge",
            "range": DisplayRange::default(),
            "unit": "", "channel": null,
        })
    },
    normalize: normalize_gauge,
    ports: value_input_ports,
    lower: sink_lower(),
};

const PROGRESS_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Progress",
    category: super::WidgetCategory::Displays,
    renderer_key: "Progress",
    fallback_label: "Progress",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Progress",
            "range": DisplayRange::default(),
            "unit": "", "orientation": "horizontal", "showValue": true, "color": "",
            "channel": null,
        })
    },
    normalize: normalize_progress,
    ports: value_input_ports,
    lower: sink_lower(),
};

const LED_DEF: WidgetDefinition = WidgetDefinition {
    kind: "LED",
    category: super::WidgetCategory::Displays,
    renderer_key: "LED",
    fallback_label: "LED",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "LED", "threshold": 0.5,
            "on_color": "#89d185", "off_color": "#3c3c3c", "channel": null,
        })
    },
    normalize: normalize_via::<LedParams>,
    ports: value_input_ports,
    lower: sink_lower(),
};

const NUMBER_DISPLAY_DEF: WidgetDefinition = WidgetDefinition {
    kind: "NumberDisplay",
    category: super::WidgetCategory::Displays,
    renderer_key: "NumberDisplay",
    fallback_label: "Value",
    default_params: |node_id| json!({ "id": node_id, "label": "Value", "unit": "", "precision": 2, "channel": null }),
    normalize: normalize_via::<NumberDisplayParams>,
    ports: value_input_ports,
    lower: sink_lower(),
};

const PIE_CHART_DEF: WidgetDefinition = WidgetDefinition {
    kind: "PieChart",
    category: super::WidgetCategory::Displays,
    renderer_key: "PieChart",
    fallback_label: "Pie",
    default_params: |node_id| json!({ "id": node_id, "label": "Pie", "segments": ["A", "B", "C"], "channels": [0, 1, 2] }),
    normalize: normalize_via::<PieChartParams>,
    ports: pie_chart_ports,
    lower: sink_lower(),
};

const IMAGE_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Image",
    category: super::WidgetCategory::Displays,
    renderer_key: "Image",
    fallback_label: "Image",
    default_params: |node_id| json!({ "id": node_id, "label": "Image", "width": 320, "height": 240, "format": "rgb888" }),
    normalize: normalize_via::<ImageParams>,
    // 图像帧尚无字节/像素协议; 不把单个 f32 伪装成图像输入
    ports: no_ports,
    lower: sink_lower(),
};

const WAVEFORM_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Waveform",
    category: super::WidgetCategory::Displays,
    renderer_key: "Waveform",
    fallback_label: "Waveform",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Waveform", "channels": 4,
            "max_points": 10000, "visible_channels": [true, true, true, true],
        })
    },
    normalize: normalize_via::<WaveformParams>,
    ports: waveform_ports,
    lower: sink_lower(),
};

const SPECTRUM_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Spectrum",
    category: super::WidgetCategory::Displays,
    renderer_key: "Spectrum",
    fallback_label: "Spectrum",
    default_params: |node_id| json!({ "id": node_id, "label": "Spectrum", "sourceId": null }),
    normalize: normalize_via::<SpectrumParams>,
    ports: spectrum_ports,
    lower: sink_lower(),
};

const MODEL3D_DEF: WidgetDefinition = WidgetDefinition {
    kind: "Model3D",
    category: super::WidgetCategory::Displays,
    renderer_key: "Model3D",
    fallback_label: "Model3D",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Model3D",
            "mode": "trajectory", "attitudeInputMode": "radians",
            "trailLength": 200, "color": "#75beff", "axisLength": 1.0,
            "modelSource": { "kind": "builtin-cube" },
        })
    },
    normalize: normalize_model3d,
    ports: model3d_ports,
    lower: sink_lower(),
};

const TABLE_VIEW_DEF: WidgetDefinition = WidgetDefinition {
    kind: "TableView",
    category: super::WidgetCategory::Displays,
    renderer_key: "TableView",
    fallback_label: "Table",
    default_params: |node_id| {
        json!({
            "id": node_id, "label": "Table",
            "columns": [
                { "portName": "ch0", "label": "CH0", "showRaw": true },
                { "portName": "ch1", "label": "CH1", "showRaw": true },
            ],
            "maxRows": 100, "showRawData": true, "showTimestamp": true,
        })
    },
    normalize: normalize_via::<TableViewParams>,
    ports: single_in_ports,
    lower: sink_lower(),
};

const RAW_DATA_DEF: WidgetDefinition = WidgetDefinition {
    kind: "RawData",
    category: super::WidgetCategory::Displays,
    renderer_key: "RawData",
    fallback_label: "Raw Data",
    default_params: |node_id| json!({ "id": node_id, "label": "Raw Data", "selectedInput": "" }),
    normalize: normalize_via::<RawDataParams>,
    ports: raw_data_ports,
    lower: sink_lower(),
};

pub(super) static LABEL: WidgetDefinition = LABEL_DEF;
pub(super) static GAUGE: WidgetDefinition = GAUGE_DEF;
pub(super) static PROGRESS: WidgetDefinition = PROGRESS_DEF;
pub(super) static LED: WidgetDefinition = LED_DEF;
pub(super) static NUMBER_DISPLAY: WidgetDefinition = NUMBER_DISPLAY_DEF;
pub(super) static PIE_CHART: WidgetDefinition = PIE_CHART_DEF;
pub(super) static IMAGE: WidgetDefinition = IMAGE_DEF;
pub(super) static WAVEFORM: WidgetDefinition = WAVEFORM_DEF;
pub(super) static SPECTRUM: WidgetDefinition = SPECTRUM_DEF;
pub(super) static MODEL3D: WidgetDefinition = MODEL3D_DEF;
pub(super) static TABLE_VIEW: WidgetDefinition = TABLE_VIEW_DEF;
pub(super) static RAW_DATA: WidgetDefinition = RAW_DATA_DEF;

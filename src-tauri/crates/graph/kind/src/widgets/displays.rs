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

use data_model::panel_descriptor::{PanelDelivery, PanelKind, panel_ops};
use serde_json::{Value, json};

use super::display_normalize::{
    normalize_gauge, normalize_model3d, normalize_progress, normalize_via,
};
use super::display_params::{
    ImageParams, LabelParams, LedParams, NumberDisplayParams, PieChartParams, RawDataParams,
    SpectrumParams, TableViewParams, WaveformParams,
};
use super::params::{DisplayRange, f32_port};
use super::{PanelBindingSpec, PanelSpec, WidgetDefinition, WidgetPortTable};

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
    panel: None,
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
    panel: None,
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
    panel: None,
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
    panel: None,
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
    panel: None,
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
    panel: Some(PanelSpec {
        panel: PanelKind::Pie,
        tab_type: "pie",
        label_key: "dataTabPie",
        delivery: PanelDelivery::Both,
        push_request: Some(panel_ops::PUSH_PORT_SAMPLES),
        fetch_op: Some(panel_ops::FETCH_GRAPH_OUTPUTS),
        binding: PanelBindingSpec::EdgeBound,
        default_interval_ms: Some(33),
        default_max_items: None,
    }),
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
    // 面板已声明 (有独立 tab), 但数据面尚未实现 — 显式声明 Unavailable,
    // 不预支一个后端无法服务的获取能力名。
    panel: Some(PanelSpec {
        panel: PanelKind::Image,
        tab_type: "image",
        label_key: "dataTabImage",
        delivery: PanelDelivery::Unavailable,
        push_request: None,
        fetch_op: None,
        binding: PanelBindingSpec::EdgeBound,
        default_interval_ms: None,
        default_max_items: None,
    }),
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
    panel: Some(PanelSpec {
        panel: PanelKind::Waveform,
        tab_type: "waveform-extra",
        label_key: "dataTabWaveform",
        delivery: PanelDelivery::Both,
        push_request: Some(panel_ops::PUSH_WAVEFORM),
        fetch_op: Some(panel_ops::FETCH_WAVEFORM_WINDOW),
        binding: PanelBindingSpec::EdgeBound,
        default_interval_ms: Some(33),
        default_max_items: Some(4096),
    }),
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
    panel: Some(PanelSpec {
        panel: PanelKind::Spectrum,
        tab_type: "spectrum",
        label_key: "dataTabSpectrum",
        delivery: PanelDelivery::Both,
        push_request: Some(panel_ops::PUSH_SPECTRUM),
        fetch_op: Some(panel_ops::FETCH_SPECTRUM),
        binding: PanelBindingSpec::EdgeBound,
        default_interval_ms: Some(33),
        default_max_items: None,
    }),
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
    panel: Some(PanelSpec {
        panel: PanelKind::Model3d,
        tab_type: "model3d",
        label_key: "dataTabModel3d",
        delivery: PanelDelivery::Both,
        push_request: Some(panel_ops::PUSH_PORT_SAMPLES),
        fetch_op: Some(panel_ops::FETCH_GRAPH_OUTPUTS),
        binding: PanelBindingSpec::EdgeBound,
        default_interval_ms: Some(17),
        default_max_items: None,
    }),
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
    panel: Some(PanelSpec {
        panel: PanelKind::TableView,
        tab_type: "table-view",
        label_key: "tableViewLabel",
        delivery: PanelDelivery::Both,
        push_request: Some(panel_ops::PUSH_PORT_SAMPLES),
        fetch_op: Some(panel_ops::FETCH_GRAPH_OUTPUTS),
        binding: PanelBindingSpec::EdgeBound,
        default_interval_ms: Some(100),
        default_max_items: Some(100),
    }),
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
    // 原始数据面板的端口由参数 `selectedInput` 持有 (静态回退口是 "data",
    // 动态口形如 `src:<sourceId>:<sourceHandle>`) — 与 describe 层的
    // derive_raw_data_ports 同源。
    panel: Some(PanelSpec {
        panel: PanelKind::Raw,
        tab_type: "raw",
        label_key: "dataTabRawData",
        delivery: PanelDelivery::Both,
        push_request: Some(panel_ops::PUSH_RAW_DATA),
        fetch_op: Some(panel_ops::FETCH_RAW_DATA),
        binding: PanelBindingSpec::ConfigBound {
            config_key: "selectedInput",
            port_template: "src:{source}:{handle}",
        },
        default_interval_ms: Some(100),
        default_max_items: Some(65536),
    }),
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

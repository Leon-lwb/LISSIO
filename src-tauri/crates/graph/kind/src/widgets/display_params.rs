//! 显示控件参数结构 — wire 形状与前端 `src/types/widgets.ts` params 一致
//! (camelCase + 全字段 serde default); 由 displays.rs 的默认/归一化/端口共用。

use super::params::{
    DisplayPrecision, DisplayRange, DisplayRangeMode, Model3DSource, Model3DSourceKind,
};
use serde::{Deserialize, Serialize};

// ============ 参数结构 ============

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct LabelParams {
    pub id: String,
    pub label: String,
    pub text: String,
    pub channel: Option<i64>,
}

impl Default for LabelParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            text: "Label".to_owned(),
            channel: None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct GaugeParams {
    pub id: String,
    pub label: String,
    pub range: DisplayRange,
    pub unit: String,
    pub channel: Option<i64>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum ProgressOrientation {
    #[default]
    Horizontal,
    Vertical,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct ProgressParams {
    pub id: String,
    pub label: String,
    pub range: DisplayRange,
    pub unit: String,
    pub orientation: ProgressOrientation,
    pub show_value: bool,
    /// '#rrggbb' 或空串 (跟随主题)
    pub color: String,
    pub channel: Option<i64>,
}

impl Default for ProgressParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            range: DisplayRange::default(),
            unit: String::new(),
            orientation: ProgressOrientation::Horizontal,
            show_value: true,
            color: String::new(),
            channel: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct LedParams {
    pub id: String,
    pub label: String,
    pub threshold: f64,
    pub on_color: String,
    pub off_color: String,
    pub channel: Option<i64>,
}

impl Default for LedParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            threshold: 0.5,
            on_color: "#89d185".to_owned(),
            off_color: "#3c3c3c".to_owned(),
            channel: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct NumberDisplayParams {
    pub id: String,
    pub label: String,
    pub unit: String,
    pub precision: i64,
    pub channel: Option<i64>,
}

impl Default for NumberDisplayParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "Value".to_owned(),
            unit: String::new(),
            precision: 2,
            channel: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct PieChartParams {
    pub id: String,
    pub label: String,
    pub segments: Vec<String>,
    pub channels: Vec<i64>,
}

impl Default for PieChartParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "Pie".to_owned(),
            segments: vec!["A".into(), "B".into(), "C".into()],
            channels: vec![0, 1, 2],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    #[serde(rename = "rgb888")]
    Rgb888,
    #[serde(rename = "rgb565")]
    Rgb565,
    #[serde(rename = "gray8")]
    Gray8,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct ImageParams {
    pub id: String,
    pub label: String,
    pub width: i64,
    pub height: i64,
    pub format: ImageFormat,
}

impl Default for ImageParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "Image".to_owned(),
            width: 320,
            height: 240,
            format: ImageFormat::Rgb888,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct WaveformParams {
    pub id: String,
    pub label: String,
    pub channels: i64,
    pub max_points: i64,
    pub visible_channels: Vec<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dynamic_series: Option<bool>,
}

impl Default for WaveformParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "Waveform".to_owned(),
            channels: 4,
            max_points: 10_000,
            visible_channels: vec![true, true, true, true],
            dynamic_series: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct SpectrumParams {
    pub id: String,
    pub label: String,
    /// 数据源 FFT widget id (null = 未选择)
    pub source_id: Option<String>,
}

impl Default for SpectrumParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "Spectrum".to_owned(),
            source_id: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum Model3DMode {
    Trajectory,
    Attitude,
    #[serde(rename = "trajectory-attitude")]
    TrajectoryAttitude,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum Model3DAttitudeInputMode {
    Degrees,
    Radians,
    Quaternion,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct Model3DParams {
    pub id: String,
    pub label: String,
    pub mode: Model3DMode,
    pub attitude_input_mode: Model3DAttitudeInputMode,
    pub trail_length: i64,
    pub color: String,
    pub axis_length: f64,
    pub model_source: Model3DSource,
}

impl Default for Model3DParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "Model3D".to_owned(),
            mode: Model3DMode::Trajectory,
            attitude_input_mode: Model3DAttitudeInputMode::Radians,
            trail_length: 200,
            color: "#75beff".to_owned(),
            axis_length: 1.0,
            model_source: Model3DSource {
                kind: Model3DSourceKind::BuiltinCube,
                path: None,
                name: None,
            },
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct TableViewColumn {
    #[serde(default)]
    pub port_name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default = "default_true")]
    pub show_raw: bool,
}

const fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct TableViewParams {
    pub id: String,
    pub label: String,
    pub columns: Vec<TableViewColumn>,
    pub max_rows: i64,
    pub show_raw_data: bool,
    pub show_timestamp: bool,
}

impl Default for TableViewParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "Table".to_owned(),
            columns: vec![
                TableViewColumn {
                    port_name: "ch0".into(),
                    label: "CH0".into(),
                    show_raw: true,
                },
                TableViewColumn {
                    port_name: "ch1".into(),
                    label: "CH1".into(),
                    show_raw: true,
                },
            ],
            max_rows: 100,
            show_raw_data: true,
            show_timestamp: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase", default)]
pub struct RawDataParams {
    pub id: String,
    pub label: String,
    pub selected_input: String,
}

impl Default for RawDataParams {
    fn default() -> Self {
        Self {
            id: String::new(),
            label: "Raw Data".to_owned(),
            selected_input: String::new(),
        }
    }
}

//! 显示控件归一化 — 移植前端 `widgetNormalize.ts` 的显示部分。
//!
//! 幂等: 已合法的配置原样返回; 旧形态 (Gauge/Progress 顶层 min/max,
//! Model3D 缺失的姿态格式与模型来源) 迁移为当前模型。

// 数值转换均为有界索引/精度语义 (JSON number <-> 定宽整数), 与前端 JS 数值
// 行为对齐; 统一豁免逐个标注的噪音。
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::suboptimal_flops
)]

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::display_params::{
    GaugeParams, Model3DAttitudeInputMode, Model3DMode, Model3DParams, ProgressParams,
};
use super::merge_unknown;
use super::params::{
    DisplayPrecision, DisplayRange, DisplayRangeMode, Model3DSource, Model3DSourceKind, finite_or,
};

// ============ 归一化 ============

/// 显示量程归一化 — 幂等; 旧配置 (range 缺失, 顶层 min/max) 迁移为 manual 量程。
pub(super) fn normalize_display_range(params: &Value) -> DisplayRange {
    let raw = params.get("range");
    let legacy_min = params
        .get("min")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite());
    let legacy_max = params
        .get("max")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite());
    let min = legacy_min.unwrap_or_else(|| {
        finite_or(
            raw.and_then(|r| r.get("min")).and_then(Value::as_f64),
            super::params::DEFAULT_DISPLAY_MIN,
        )
    });
    let proposed_max = legacy_max.unwrap_or_else(|| {
        finite_or(
            raw.and_then(|r| r.get("max")).and_then(Value::as_f64),
            super::params::DEFAULT_DISPLAY_MAX,
        )
    });
    let max = if proposed_max > min {
        proposed_max
    } else {
        min + 100.0
    };
    let raw_window = finite_or(
        raw.and_then(|r| r.get("windowSec")).and_then(Value::as_f64),
        super::params::DEFAULT_DISPLAY_WINDOW_SEC,
    );
    let window_sec = if raw_window > 0.0 { raw_window } else { 10.0 }.clamp(1.0, 3600.0);
    let raw_precision = raw.and_then(|r| r.get("precision"));
    let precision = match raw_precision {
        Some(Value::Number(_)) => DisplayPrecision::Fixed(
            finite_or(raw_precision.and_then(Value::as_f64), 0.0)
                .round()
                .clamp(0.0, 6.0),
        ),
        _ => DisplayPrecision::default(),
    };
    let major_ticks = finite_or(
        raw.and_then(|r| r.get("majorTicks"))
            .and_then(Value::as_f64),
        super::params::DEFAULT_DISPLAY_MAJOR_TICKS as f64,
    )
    .round()
    .clamp(2.0, 11.0) as i64;
    DisplayRange {
        mode: if raw.and_then(|r| r.get("mode")).and_then(Value::as_str) == Some("auto") {
            DisplayRangeMode::Auto
        } else {
            DisplayRangeMode::Manual
        },
        min,
        max,
        window_sec,
        major_ticks,
        precision,
    }
}

fn hex_color_or_empty(value: &Value) -> String {
    match value.as_str() {
        Some(text) if is_hex_color(text) => text.to_owned(),
        _ => String::new(),
    }
}

pub(super) fn is_hex_color(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit)
}

pub(super) fn normalize_via<T: DeserializeOwned + Serialize>(params: &mut Value) {
    super::round_trip_params::<T>(params, &[]);
}

pub(super) fn normalize_gauge(params: &mut Value) {
    // 旧配置: 顶层 min/max → range (normalize_display_range 处理); legacy 键不保留
    let range = normalize_display_range(params);
    let parsed: GaugeParams = serde_json::from_value(params.clone()).unwrap_or_default();
    if let Ok(mut wire) = serde_json::to_value(GaugeParams {
        range: range.clone(),
        ..parsed
    }) {
        if let Some(object) = wire.as_object_mut() {
            object.insert(
                "range".into(),
                serde_json::to_value(range).expect("range serializes"),
            );
        }
        merge_unknown(params, &mut wire, &["min", "max"]);
        *params = wire;
    }
}

pub(super) fn normalize_progress(params: &mut Value) {
    let range = normalize_display_range(params);
    if let Ok(mut wire) = serde_json::from_value::<ProgressParams>(params.clone())
        .and_then(|parsed| serde_json::to_value(&parsed))
    {
        if let Some(object) = wire.as_object_mut() {
            object.insert(
                "range".into(),
                serde_json::to_value(range).expect("range serializes"),
            );
        }
        merge_unknown(params, &mut wire, &["min", "max"]);
        *params = wire;
    }
}

pub(super) fn normalize_model3d(params: &mut Value) {
    // 移植 normalizeModel3DConfig: 旧数据补齐姿态格式与模型来源
    let mode = match params.get("mode").and_then(Value::as_str) {
        Some("attitude") => Model3DMode::Attitude,
        Some("trajectory-attitude") => Model3DMode::TrajectoryAttitude,
        Some("trajectory") => Model3DMode::Trajectory,
        _ => Model3DMode::Trajectory,
    };
    let attitude_input_mode = match params.get("attitudeInputMode").and_then(Value::as_str) {
        Some("degrees") => Model3DAttitudeInputMode::Degrees,
        Some("quaternion") => Model3DAttitudeInputMode::Quaternion,
        _ => Model3DAttitudeInputMode::Radians,
    };
    let color = match params.get("color").and_then(Value::as_str) {
        Some(text) if is_hex_color(text) => text.to_owned(),
        _ => "#75beff".to_owned(),
    };
    let trail_length = {
        let raw = params
            .get("trailLength")
            .and_then(Value::as_f64)
            .unwrap_or(200.0);
        if raw > 0.0 && raw.is_finite() {
            raw as i64
        } else {
            200
        }
    };
    let axis_length = {
        let raw = params
            .get("axisLength")
            .and_then(Value::as_f64)
            .unwrap_or(1.0);
        if raw > 0.0 && raw.is_finite() {
            raw
        } else {
            1.0
        }
    };
    let source = params.get("modelSource");
    let model_source = if source.and_then(|s| s.get("kind")).and_then(Value::as_str)
        == Some("custom")
        && source
            .and_then(|s| s.get("path"))
            .and_then(Value::as_str)
            .is_some()
    {
        Model3DSource {
            kind: Model3DSourceKind::Custom,
            path: Some(
                source
                    .and_then(|s| s.get("path"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            ),
            name: Some(
                source
                    .and_then(|s| s.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or("model.glb")
                    .to_owned(),
            ),
        }
    } else {
        Model3DSource {
            kind: Model3DSourceKind::BuiltinCube,
            path: None,
            name: None,
        }
    };
    if let Ok(mut wire) = serde_json::to_value(&Model3DParams {
        id: String::new(),
        label: String::new(),
        mode,
        attitude_input_mode,
        trail_length,
        color,
        axis_length,
        model_source,
    }) {
        if let Some(object) = wire.as_object_mut() {
            // id/label 由注册表归一化统一注入; trail/axis 保持 f64 序列化
            object.remove("id");
            object.remove("label");
        }
        merge_unknown(params, &mut wire, &[]);
        *params = wire;
    }
}

//! Serde golden fixture tests — wire JSON 与 Rust 类型的真实往返验证。
//!
//! ts-rs 的 TS 导出不保证覆盖每个 serde 属性的语义; 这组 fixture 用真实
//! wire 形状 (源自前端构造器与历史工作区) 证明反序列化 + 再序列化无漂移。
//! 修改任何 wire 类型后, 若 fixture 失败, 先确认 JSON 拼写是否真的需要变。

use std::include_str;

/// 数值统一为 f64 — JSON 数字无整型/浮点之分, serde_json 的
/// Number(120) != Number(120.0) 是表示层伪差异, 不属于 wire 漂移。
fn canonicalize(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Number(number) => {
            if let Some(as_f64) = number.as_f64() {
                *value = serde_json::Value::from(as_f64);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                canonicalize(item);
            }
        }
        serde_json::Value::Object(fields) => {
            for field in fields.values_mut() {
                canonicalize(field);
            }
        }
        _ => {}
    }
}

/// fixture JSON → Rust 类型 → JSON, 再序列化结果必须与原始 JSON 语义相等
/// (对象键序不敏感, 数组保持顺序, 数值不分整型/浮点)。
fn assert_round_trip<T>(json: &str)
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let mut original: serde_json::Value =
        serde_json::from_str(json).unwrap_or_else(|e| panic!("fixture 自身不是合法 JSON: {e}"));
    let parsed: T = serde_json::from_value(original.clone())
        .unwrap_or_else(|e| panic!("反序列化失败 (wire 拼写与 Rust 类型漂移?): {e}"));
    let mut re_serialized =
        serde_json::to_value(&parsed).unwrap_or_else(|e| panic!("再序列化失败: {e}"));
    canonicalize(&mut original);
    canonicalize(&mut re_serialized);
    assert_eq!(
        re_serialized, original,
        "wire 往返漂移 — Rust 序列化结果与 fixture 不同"
    );
}

#[test]
fn widget_node_document_round_trips() {
    assert_round_trip::<kind::document::NodeDocument>(include_str!(
        "fixtures/node_document_widget_math.json"
    ));
}

#[test]
fn device_node_document_round_trips() {
    assert_round_trip::<kind::document::NodeDocument>(include_str!(
        "fixtures/node_document_device_serial.json"
    ));
}

#[test]
fn point_selector_node_document_round_trips() {
    assert_round_trip::<kind::document::NodeDocument>(include_str!(
        "fixtures/node_document_point_selector.json"
    ));
}

#[test]
fn justfloat_protocol_schema_round_trips() {
    assert_round_trip::<schema_types::ProtocolSchema>(include_str!(
        "fixtures/protocol_schema_justfloat.json"
    ));
}

#[test]
fn simulation_config_round_trips() {
    assert_round_trip::<data_model::device::SimulationConfig>(include_str!(
        "fixtures/simulation_config.json"
    ));
}

#[test]
fn adapter_capability_round_trips() {
    assert_round_trip::<acquisition::AdapterCapability>(include_str!(
        "fixtures/adapter_capability_serial.json"
    ));
}

#[test]
fn model_catalog_round_trips() {
    assert_round_trip::<data_model::model_descriptor::ModelCatalog>(include_str!(
        "fixtures/model_catalog_entry.json"
    ));
}

#[test]
fn node_state_wire_keeps_historical_field_spelling() {
    // NodeState 枚举未做字段级 rename: wire 上是 connection_epoch (snake)。
    // 前端旧镜像曾误写为 connectionEpoch — 以真实 wire 为准, 生成类型与其一致。
    let wire = serde_json::json!({"state": "online", "connection_epoch": 7});
    let state: data_model::device_tree::NodeState =
        serde_json::from_value(wire).expect("NodeState wire 应可解析");
    assert_eq!(
        serde_json::to_value(&state).unwrap(),
        serde_json::json!({"state": "online", "connection_epoch": 7})
    );
}

#[test]
fn point_value_wide_integers_stay_strings_on_wire() {
    let value: points::PointValue =
        serde_json::from_value(serde_json::json!({"kind": "u64", "value": "18446744073709551615"}))
            .expect("u64 点值按字符串编码");
    match value {
        points::PointValue::U64(inner) => assert_eq!(inner, u64::MAX),
        other => panic!("意外的点值变体: {other:?}"),
    }
}

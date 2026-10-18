//! 触发器控件: 参数 → 图侧规则的有类型转换与 wire 形状。

use super::super::{lower, normalize_params};
use super::*;
use serde_json::json;

/// 注册表归一化后的规范形状 — `InputBinding` 的 serde 形状是 PascalCase
/// (`{"Mode": "None"}`), 这里用序列化结果而不是手写字面量, 避免测试自己漂移。
fn canonical_params(default_miss: f64, rule: TriggerRule) -> Value {
    serde_json::to_value(TriggerParams {
        id: "t1".to_owned(),
        label: "Trigger".to_owned(),
        mode: "manual".to_owned(),
        edge: TriggerEdge::Level,
        default_miss,
        default_miss_text: String::new(),
        command: "HELLO".to_owned(),
        rules: vec![rule],
        binding: super::super::params::InputBinding::none(),
    })
    .expect("TriggerParams serializes")
}

fn rule(output_value: f64) -> TriggerRule {
    TriggerRule {
        id: "r1".to_owned(),
        pattern: "HELLO".to_owned(),
        match_type: TriggerMatchType::Regex,
        flags: Some("i".to_owned()),
        output_type: TriggerOutputType::String,
        output_value,
        output_text: "hit".to_owned(),
        enabled: false,
    }
}

#[test]
fn conversion_maps_every_field_directly() {
    let converted = TriggerRuleDef::try_from(&rule(1.5)).expect("1.5 is in f32 range");
    assert_eq!(converted.id, "r1");
    assert_eq!(converted.pattern, "HELLO");
    assert_eq!(converted.match_type, TriggerMatchType::Regex);
    assert_eq!(converted.flags.as_deref(), Some("i"));
    assert_eq!(converted.output_type, "string");
    assert!((converted.output_value - 1.5).abs() < f32::EPSILON);
    assert_eq!(converted.output_text, "hit");
    assert!(!converted.enabled);
}

#[test]
fn wire_form_is_camel_case() {
    let converted = TriggerRuleDef::try_from(&rule(1.0)).expect("1.0 is in f32 range");
    let wire = serde_json::to_value(&converted).expect("TriggerRuleDef serializes");
    assert_eq!(wire["matchType"], json!("regex"));
    assert_eq!(wire["outputType"], json!("string"));
    assert_eq!(wire["outputValue"], json!(1.0));
    assert_eq!(wire["outputText"], json!("hit"));
}

#[test]
fn out_of_range_narrowing_returns_an_error_instead_of_panicking() {
    let error = TriggerRuleDef::try_from(&rule(f64::MAX)).expect_err("f64::MAX is not an f32");
    assert_eq!(
        error.to_string(),
        "trigger rule `outputValue` is outside the f32 range of the graph evaluation plane"
    );
}

#[test]
fn lowering_keeps_valid_rules() {
    let params = canonical_params(2.5, rule(1.0));
    let lowered = (TRIGGER_DEF.lower)(&params, None).expect("canonical params lower");
    let crate::kind::NodeKind::Trigger {
        default_miss,
        command,
        rules,
        ..
    } = lowered
    else {
        panic!("Trigger params must lower to NodeKind::Trigger");
    };
    assert_eq!(command, "HELLO");
    assert!((default_miss - 2.5).abs() < f32::EPSILON);
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].id, "r1");
    assert_eq!(rules[0].match_type, TriggerMatchType::Regex);
    assert_eq!(rules[0].flags.as_deref(), Some("i"));
    assert_eq!(rules[0].output_type, "string");
    assert!((rules[0].output_value - 1.0).abs() < f32::EPSILON);
    assert!(!rules[0].enabled);
}

/// 旧的 `serde_json::from_value(..).expect(..)` 会在越界收窄时 panic;
/// 现在同样的输入必须经 `lower` 返回错误字符串。
#[test]
fn lowering_reports_out_of_range_rule_value_instead_of_panicking() {
    let params = canonical_params(0.0, rule(1e300));
    let error = (TRIGGER_DEF.lower)(&params, None).expect_err("1e300 is not an f32");
    assert_eq!(
        error,
        "trigger rule `outputValue` is outside the f32 range of the graph evaluation plane"
    );
}

#[test]
fn lowering_reports_out_of_range_default_miss() {
    let params = canonical_params(1e300, rule(1.0));
    let error = (TRIGGER_DEF.lower)(&params, None).expect_err("1e300 is not an f32");
    assert_eq!(
        error,
        "trigger rule `defaultMiss` is outside the f32 range of the graph evaluation plane"
    );
}

/// 目录默认值 → 注册表归一化 → 上图 (真实创建路径): 小写 binding 必须被归一化,
/// 否则 `TriggerParams` 反序列化失败, 控件根本进不了图。
#[test]
fn catalog_defaults_normalize_and_lower() {
    let mut params = TRIGGER_DEF.default_params("t1");
    normalize_params("Trigger", &mut params).expect("catalog defaults normalize");
    let lowered = lower("Trigger", &params, None).expect("catalog defaults lower");
    let crate::kind::NodeKind::Trigger { rules, .. } = lowered else {
        panic!("Trigger params must lower to NodeKind::Trigger");
    };
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].match_type, TriggerMatchType::Exact);
}

/// binding 可以已是规范形状 (prepare 产物再次归一化): 不得被抹成 None, 且幂等。
#[test]
fn canonical_binding_survives_normalize_idempotently() {
    let mut params = canonical_params(0.0, rule(1.0));
    params["binding"] = json!({
        "mode": "Auto",
        "params": { "transportId": "dev-1", "protocolId": "proto-1", "channel": 2 },
    });
    normalize_params("Trigger", &mut params).expect("first normalize");
    let first = params["binding"].clone();
    assert_eq!(
        first["Mode"],
        json!("Auto"),
        "binding must be canonicalized"
    );
    assert_eq!(first["Params"]["transportId"], json!("dev-1"));
    normalize_params("Trigger", &mut params).expect("second normalize");
    assert_eq!(params["binding"], first, "normalize must be idempotent");
    lower("Trigger", &params, None).expect("canonical binding lowers");
}

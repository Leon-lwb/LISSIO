use super::{RpcError, normalize_args, optional, required, to_snake_case};
use serde_json::json;

#[test]
fn snake_case_conversion_matches_tauri_rules() {
    assert_eq!(to_snake_case("tabId"), "tab_id");
    assert_eq!(to_snake_case("baseVersion"), "base_version");
    assert_eq!(to_snake_case("documents"), "documents");
    assert_eq!(to_snake_case("nodeId"), "node_id");
}

#[test]
fn normalize_only_touches_top_level_keys() {
    let args = json!({ "tabId": "t1", "payload": { "driverId": "serial" } });
    let normalized = normalize_args(args);
    assert_eq!(normalized["tab_id"], json!("t1"));
    assert_eq!(normalized["payload"]["driverId"], json!("serial"));
}

#[test]
fn required_and_optional_report_missing_fields() {
    let args = json!({ "node_id": "n1", "interval": null });
    assert_eq!(
        required::<String>(&args, "send_raw", "node_id").unwrap(),
        "n1"
    );
    assert!(required::<String>(&args, "send_raw", "data").is_err());
    assert_eq!(
        optional::<u64>(&args, "send_raw", "interval").unwrap(),
        None
    );
}

#[test]
fn unsupported_error_carries_command_name() {
    let error = RpcError::unsupported("inspect_element");
    assert_eq!(error.kind, "UnsupportedCommand");
    assert!(error.message.contains("inspect_element"));
}

/// 域错误信封的 `data` 是域错误自带字段的单层平铺, 不是 `AppError`
/// 的整体序列化 — 前端读 `error.data.current`, 而不是 `error.data.data.current`。
#[test]
fn domain_error_envelope_flattens_data_without_nesting() {
    let conflict = error::AppError::Config(error::ConfigError::GraphVersionConflict { current: 9 });
    let envelope = serde_json::to_value(RpcError::domain(&conflict)).expect("serialize envelope");
    assert_eq!(envelope["kind"], json!("GraphVersionConflict"));
    assert_eq!(envelope["data"]["current"], json!("9"));
    assert!(
        envelope["data"].get("data").is_none(),
        "domain data must be flat: {envelope}"
    );
}

/// 无结构化字段的域错误省略 `data` (不是空对象, 也不是整枚举快照)。
#[test]
fn domain_error_without_fields_omits_data() {
    let error = error::AppError::Config(error::ConfigError::AutoBindingMissingProtocolNode);
    let envelope = serde_json::to_value(RpcError::domain(&error)).expect("serialize envelope");
    assert_eq!(envelope["kind"], json!("Config"));
    assert!(
        envelope.get("data").is_none(),
        "no fields → no data: {envelope}"
    );
}

use super::*;
use serde_json::json;

#[test]
fn request_unpacks_camel_case_addressing() {
    let (panel, target, params) = parse_request(
        "fetch_panel_data",
        &json!({
            "panelKind": "table-view",
            "nodeId": "n1",
            "port": "value",
            "params": { "count": 7 },
        }),
    )
    .expect("合法请求");
    assert_eq!(panel, PanelKind::TableView);
    assert_eq!(target, NodePortTarget::at_port("n1", "value"));
    assert_eq!(params.count, Some(7));
}

#[test]
fn addressing_fields_default_to_node_level_and_empty_params() {
    let (panel, target, params) = parse_request("fetch_panel_data", &json!({ "panelKind": "can" }))
        .expect("整库面板无需寻址");
    assert_eq!(panel, PanelKind::Can);
    assert_eq!(target, NodePortTarget::default());
    assert_eq!(params.count, None);
}

#[test]
fn missing_panel_kind_is_an_argument_error() {
    let error =
        parse_request("fetch_panel_data", &json!({ "nodeId": "n1" })).expect_err("panelKind 必填");
    assert_eq!(error.kind, "InvalidArguments");
    assert!(error.message.contains("panel_kind"), "{}", error.message);
}

#[test]
fn unknown_panel_kind_is_rejected() {
    let error = parse_request("fetch_panel_data", &json!({ "panelKind": "hologram" }))
        .expect_err("未知面板身份");
    assert_eq!(error.kind, "InvalidArguments");
    assert!(error.message.contains("panel_kind"), "{}", error.message);
}

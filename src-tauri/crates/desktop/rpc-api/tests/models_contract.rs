//! 模型目录/准备/描述 RPC 合同测试 — 参数解码、错误 kind 与无副作用。

use rpc_api::models::{PrepareOperationDto, PrepareOutcome, PrepareRequest, PrepareResponse};

#[test]
fn prepare_request_decodes_camel_case_with_tagged_ops() {
    let wire = serde_json::json!({
        "catalogRevision": "rev-1",
        "operations": [
            {
                "op": "create",
                "modelId": "widget:Math",
                "variantId": "add",
                "nodeId": "n1",
                "tabId": "t1",
                "layout": { "x": 0, "y": 0, "width": null, "height": null },
                "configPatch": { "op": "add" }
            },
            {
                "op": "normalize",
                "document": {
                    "id": "w1", "tabId": "t1", "label": "W",
                    "layout": { "x": 0, "y": 0, "width": null, "height": null },
                    "kind": "widget",
                    "config": { "widgetKind": "Knob", "params": {}, "customPorts": null }
                }
            }
        ]
    });
    let request: PrepareRequest = serde_json::from_value(wire).expect("request decodes");
    assert_eq!(request.catalog_revision, "rev-1");
    assert_eq!(request.operations.len(), 2);
    assert!(matches!(
        request.operations[0],
        PrepareOperationDto::Create { .. }
    ));
    assert!(matches!(
        request.operations[1],
        PrepareOperationDto::Normalize { .. }
    ));
}

#[test]
fn prepare_outcome_wire_uses_ok_tag() {
    let response = PrepareResponse {
        catalog_revision: "rev-1".into(),
        results: vec![
            PrepareOutcome::Failed {
                code: "model/unknown".into(),
                message: "unknown model id: x".into(),
            },
            PrepareOutcome::Ok {
                document: serde_json::from_value(serde_json::json!({
                    "id": "n", "tabId": "t", "label": "L",
                    "layout": { "x": 0, "y": 0, "width": null, "height": null },
                    "kind": "widget",
                    "config": { "widgetKind": "Knob", "params": {}, "customPorts": null }
                }))
                .unwrap(),
                issues: vec![],
            },
        ],
    };
    let wire = serde_json::to_value(&response).unwrap();
    assert_eq!(wire["results"][0]["status"], "failed");
    assert_eq!(wire["results"][0]["code"], "model/unknown");
    assert_eq!(wire["results"][1]["status"], "ok");
    assert_eq!(wire["results"][1]["document"]["id"], "n");
    assert_eq!(wire["catalogRevision"], "rev-1");
}

#[test]
fn catalog_revision_mismatch_is_a_stable_error_kind() {
    // 错误 kind 是前端重试决策的依据 — 拼写必须稳定
    assert_eq!(
        rpc_api::models::CATALOG_REVISION_MISMATCH,
        "CatalogRevisionMismatch"
    );
}

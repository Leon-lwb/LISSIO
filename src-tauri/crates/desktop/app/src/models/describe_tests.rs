//! describe 用例测试。

use super::*;
use kind::document::{NodeBusiness, NodeLayout};

fn widget_document(widget_kind: &str, params: serde_json::Value) -> NodeDocument {
    NodeDocument {
        id: "w1".into(),
        tab_id: "t1".into(),
        label: widget_kind.into(),
        layout: NodeLayout {
            x: 0.0,
            y: 0.0,
            width: None,
            height: None,
        },
        business: NodeBusiness::Widget {
            widget_kind: widget_kind.into(),
            params,
            custom_ports: None,
        },
    }
}

#[test]
fn math_ports_follow_unary_rule() {
    let request = DescribeRequest {
        documents: vec![widget_document(
            "Math",
            serde_json::json!({ "op": "add", "inputCount": 3 }),
        )],
        edges: vec![],
        request_revision: 7,
    };
    let result = describe_documents(&request);
    assert_eq!(result.request_revision, 7);
    let math = &result.nodes[0];
    assert_eq!(math.status, NodeDescriptionStatus::Ready);
    assert_eq!(math.inputs.len(), 3);
    assert_eq!(math.default_output.as_deref(), Some("result"));

    let request = DescribeRequest {
        documents: vec![widget_document(
            "Math",
            serde_json::json!({ "op": "sqrt", "inputCount": 4 }),
        )],
        edges: vec![],
        request_revision: 7,
    };
    assert_eq!(describe_documents(&request).nodes[0].inputs.len(), 1);
}

#[test]
fn unknown_widget_is_unsupported_not_empty() {
    let request = DescribeRequest {
        documents: vec![widget_document("Nope", serde_json::json!({}))],
        edges: vec![],
        request_revision: 1,
    };
    let node = &describe_documents(&request).nodes[0];
    assert_eq!(node.status, NodeDescriptionStatus::Unsupported);
    assert!(!node.issues.is_empty());
}

#[test]
fn custom_without_ports_is_incomplete() {
    let request = DescribeRequest {
        documents: vec![widget_document(
            "Custom",
            serde_json::json!({ "code": "..." }),
        )],
        edges: vec![],
        request_revision: 1,
    };
    let node = &describe_documents(&request).nodes[0];
    assert_eq!(node.status, NodeDescriptionStatus::Incomplete);
    assert!(node.inputs.is_empty(), "不伪造默认口");
}

#[test]
fn raw_data_ports_derive_from_edges() {
    let request = DescribeRequest {
        documents: vec![widget_document("RawData", serde_json::json!({}))],
        edges: vec![
            GraphEdgeRef {
                source: "dev1".into(),
                source_handle: Some("rx".into()),
                target: "w1".into(),
                target_handle: None,
            },
            GraphEdgeRef {
                source: "dev2".into(),
                source_handle: None,
                target: "w1".into(),
                target_handle: None,
            },
        ],
        request_revision: 3,
    };
    let node = &describe_documents(&request).nodes[0];
    let handles: Vec<_> = node.inputs.iter().map(|p| p.handle.as_str()).collect();
    assert_eq!(handles, ["src:dev1:rx", "src:dev2:data"]);
    assert!(node.inputs.iter().all(|p| p.dynamic));
}

#[test]
fn text_display_default_input_is_text() {
    let request = DescribeRequest {
        documents: vec![widget_document("TextDisplay", serde_json::json!({}))],
        edges: vec![],
        request_revision: 1,
    };
    let node = &describe_documents(&request).nodes[0];
    assert_eq!(node.default_input.as_deref(), Some("text"));
}

#[test]
fn protocol_description_reports_channels() {
    let protocol: schema_types::ProtocolConfig =
        serde_json::from_str(r#"{ "kind": "JustFloat", "channels": 2 }"#).unwrap();
    let document = NodeDocument {
        id: "p1".into(),
        tab_id: "t1".into(),
        label: "Parser".into(),
        layout: NodeLayout {
            x: 0.0,
            y: 0.0,
            width: None,
            height: None,
        },
        business: NodeBusiness::Protocol {
            protocol,
            convert_to: None,
            schema: schema_types::justfloat_schema(Some(2)),
        },
    };
    let request = DescribeRequest {
        documents: vec![document],
        edges: vec![],
        request_revision: 1,
    };
    let node = &describe_documents(&request).nodes[0];
    assert_eq!(node.outputs.len(), 2);
    assert_eq!(node.effective_channels, Some(2));
}

// ---- 逐节点容错: 单条文档不合法不得中断整批 ----

/// 未知 kind 的原始文档 — 前端 `node.type` 未映射时的真实形态。
fn unknown_kind_document(id: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "tabId": "t1",
        "label": "Mystery",
        "layout": { "x": 0.0, "y": 0.0, "width": null, "height": null },
        "kind": "mystery",
        "config": {},
    })
}

#[test]
fn invalid_document_does_not_block_the_rest_of_the_batch() {
    let valid_first = serde_json::to_value(widget_document(
        "Math",
        serde_json::json!({ "op": "add", "inputCount": 3 }),
    ))
    .expect("document serializes");
    let valid_last = serde_json::to_value(widget_document("TextDisplay", serde_json::json!({})))
        .expect("document serializes");

    let batch = DescribeBatch::decode(
        &[valid_first, unknown_kind_document("bad"), valid_last],
        vec![],
        11,
    );
    let result = describe_batch(&batch);

    assert_eq!(result.request_revision, 11);
    assert_eq!(
        result.nodes.len(),
        3,
        "每条文档都必须产出恰好一条描述 (不得因一条失败而少给)"
    );
    // 失败节点前后的合法节点必须照常拿到完整端口
    assert_eq!(result.nodes[0].status, NodeDescriptionStatus::Ready);
    assert_eq!(result.nodes[0].inputs.len(), 3);
    assert_eq!(result.nodes[1].status, NodeDescriptionStatus::Unsupported);
    assert_eq!(result.nodes[1].node_id, "bad");
    assert_eq!(result.nodes[1].issues[0].code, "document/invalid");
    assert_eq!(result.nodes[2].status, NodeDescriptionStatus::Ready);
    assert_eq!(result.nodes[2].default_input.as_deref(), Some("text"));
}

#[test]
fn invalid_document_is_reported_without_an_id() {
    let batch = DescribeBatch::decode(
        &[serde_json::json!({ "kind": "mystery", "config": {} })],
        vec![],
        1,
    );
    let result = describe_batch(&batch);
    assert_eq!(result.nodes.len(), 1);
    assert_eq!(result.nodes[0].node_id, UNKNOWN_NODE_ID);
    assert_eq!(result.nodes[0].status, NodeDescriptionStatus::Unsupported);
}

#[test]
fn invalid_document_keeps_the_batch_edges_available_to_valid_nodes() {
    // RawData 的动态端口由连线派生 — 批内存在坏文档时, 合法节点的连线推断不得丢失
    let raw_data = serde_json::to_value(widget_document("RawData", serde_json::json!({})))
        .expect("document serializes");
    let batch = DescribeBatch::decode(
        &[unknown_kind_document("bad"), raw_data],
        vec![GraphEdgeRef {
            source: "dev1".into(),
            source_handle: Some("rx".into()),
            target: "w1".into(),
            target_handle: None,
        }],
        5,
    );
    let result = describe_batch(&batch);
    assert_eq!(result.nodes[1].status, NodeDescriptionStatus::Ready);
    assert_eq!(result.nodes[1].inputs.len(), 1);
    assert_eq!(result.nodes[1].inputs[0].handle, "src:dev1:rx");
    assert!(matches!(
        result.nodes[1].hint,
        Some(NodeHint::RawDataRouting)
    ));
}

#[test]
fn a_batch_of_invalid_documents_still_answers_every_node() {
    let documents: Vec<serde_json::Value> = (0..4)
        .map(|index| unknown_kind_document(&format!("bad{index}")))
        .collect();
    let batch = DescribeBatch::decode(&documents, vec![], 2);
    let result = describe_batch(&batch);
    assert_eq!(result.nodes.len(), 4);
    let ids: Vec<&str> = result.nodes.iter().map(|n| n.node_id.as_str()).collect();
    assert_eq!(ids, ["bad0", "bad1", "bad2", "bad3"]);
    assert!(
        result.nodes.iter().all(
            |node| node.status == NodeDescriptionStatus::Unsupported && !node.issues.is_empty()
        )
    );
}

#[test]
fn strict_entry_point_answers_exactly_the_requested_documents() {
    // describe_documents (强类型入口) 与 describe_batch (线缆入口) 必须产出同一形状
    let request = DescribeRequest {
        documents: vec![widget_document("Math", serde_json::json!({ "op": "add" }))],
        edges: vec![],
        request_revision: 9,
    };
    let batch = DescribeBatch::decode(
        &[serde_json::to_value(&request.documents[0]).expect("document serializes")],
        vec![],
        9,
    );
    let strict = describe_documents(&request);
    let tolerant = describe_batch(&batch);
    assert_eq!(strict.request_revision, tolerant.request_revision);
    assert_eq!(strict.nodes.len(), tolerant.nodes.len());
    assert_eq!(strict.nodes[0].node_id, tolerant.nodes[0].node_id);
    assert_eq!(strict.nodes[0].inputs.len(), tolerant.nodes[0].inputs.len());
    assert_eq!(
        strict.nodes[0].outputs.len(),
        tolerant.nodes[0].outputs.len()
    );
}

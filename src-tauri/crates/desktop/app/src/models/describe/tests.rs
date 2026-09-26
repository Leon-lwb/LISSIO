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

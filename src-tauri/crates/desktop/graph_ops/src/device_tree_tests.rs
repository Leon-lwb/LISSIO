use app::AppState;
use data_model::device_tree::NodeDecl;
use graph_testkit::{edge, make_device_in, make_sink};
use kind::{NodeDef, NodeKind};
use pipeline::byte_router::route_bytes;
use pipeline::decoder_feed::DecoderFeedCache;
use schema_types::ProtocolConfig;
use serde_json::json;
use std::collections::HashMap;

fn protocol(id: &str) -> NodeDecl {
    NodeDecl::leaf(
        id,
        id,
        "protocol-engine",
        1,
        json!({
            "protocol": ProtocolConfig::FireWater { channels: Some(2) },
            "convertTo": null,
            "schema": null
        }),
    )
    .unwrap()
}

fn device(children: Vec<NodeDecl>) -> NodeDef {
    let mut device = make_device_in("source", "tab");
    if let NodeKind::Acquisition { node, .. } = &mut device.kind {
        node.children = children;
    }
    device
}

async fn apply(state: &AppState, root: NodeDef) -> data_model::Result<crate::GraphDerived> {
    crate::apply_tab_graph(
        state,
        None,
        "tab".into(),
        vec![root, make_sink("display", "tab")],
        vec![edge("value", "parser", "ch0", "display", "value")],
        HashMap::new(),
        None,
        None,
    )
    .await
}

#[tokio::test]
async fn nested_protocol_feeds_existing_data_plane_without_persisting_attachment_edges() {
    let state = AppState::new();
    let root = device(vec![protocol("parser")]);
    let derived = apply(&state, root).await.unwrap();
    assert!(derived.nodes.iter().any(|node| node.node_id == "parser"));
    assert_eq!(state.source_graphs.lock()["tab"].edges.len(), 1);
    assert_eq!(
        state.data_plane.byte_plan.lock().routes_for("source").len(),
        1
    );

    let mut cache = DecoderFeedCache::new();
    let result = route_bytes(
        &state.data_plane,
        None,
        "source",
        b"1,2\n",
        0,
        &mut cache,
        None,
    )
    .await;
    state.data_plane.flush_eval();
    assert_eq!(result.frames, 1);
    assert_eq!(
        state.data_plane.source_frames.lock()["parser"].channels,
        vec![1.0, 2.0]
    );
}

#[tokio::test]
async fn disabled_protocol_subtree_keeps_identity_without_receiving_bytes() {
    let state = AppState::new();
    let mut parser = protocol("parser");
    parser.enabled = false;
    parser.children.push(protocol("nested"));
    apply(&state, device(vec![parser])).await.unwrap();
    assert!(state.data_plane.global_nodes.lock().contains_key("nested"));
    assert!(
        state
            .data_plane
            .byte_plan
            .lock()
            .routes_for("source")
            .is_empty()
    );
    assert!(
        state
            .data_plane
            .byte_plan
            .lock()
            .routes_for("parser")
            .is_empty()
    );
}

#[tokio::test]
async fn protocol_children_are_compiled_in_parent_order() {
    let state = AppState::new();
    let mut parser = protocol("parser");
    parser.config["convertTo"] =
        serde_json::to_value(ProtocolConfig::JustFloat { channels: Some(2) }).unwrap();
    let mut child = protocol("nested");
    child.config["protocol"] = parser.config["convertTo"].clone();
    parser.children.push(child);
    apply(&state, device(vec![parser])).await.unwrap();
    let mut cache = DecoderFeedCache::new();
    route_bytes(
        &state.data_plane,
        None,
        "source",
        b"3,4\n",
        0,
        &mut cache,
        None,
    )
    .await;
    state.data_plane.flush_eval();
    assert_eq!(
        state.data_plane.source_frames.lock()["nested"].channels,
        vec![3.0, 4.0]
    );
}

#[tokio::test]
async fn nested_identity_collisions_are_rejected_without_replacing_graph() {
    let state = AppState::new();
    apply(&state, device(vec![protocol("parser")]))
        .await
        .unwrap();
    let version = state
        .graphs_version
        .load(std::sync::atomic::Ordering::Relaxed);
    let result = apply(
        &state,
        device(vec![protocol("parser"), protocol("display")]),
    )
    .await;
    assert!(result.unwrap_err().to_string().contains("duplicated"));
    assert_eq!(
        state
            .graphs_version
            .load(std::sync::atomic::Ordering::Relaxed),
        version
    );
}

#[test]
fn explicit_edges_cannot_bypass_parent_or_enable_disabled_parsers() {
    let mut parser = protocol("parser");
    parser.enabled = false;
    let mut nodes = vec![device(vec![parser])];
    let mut edges = vec![edge("bypass", "source", "rx", "parser", "in")];
    let error = super::device_tree::project(&mut nodes, &mut edges).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("supplied by its device tree parent")
    );
}

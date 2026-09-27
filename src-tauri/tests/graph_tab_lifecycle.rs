//! 页签节点归属与删除语义集成测试。
//!
//! 每个节点只属于一个创建页签；删除页签会清理其节点和运行态，其他页签不受影响。

use app::AppState;
use app::{NodeDef, NodeKind};
use graph_ops::{apply_remove_tab_graph, apply_tab_graph};
use schema_types::ProtocolConfig;
use std::collections::HashMap;

fn device_node(id: &str, tab_id: &str) -> NodeDef {
    graph_testkit::make_device_in(id, tab_id)
}

fn protocol_node(id: &str, tab_id: &str) -> NodeDef {
    NodeDef::new(
        id.into(),
        tab_id.into(),
        NodeKind::Protocol {
            schema: schema_types::schema_from_protocol_config(&ProtocolConfig::JustFloat {
                channels: Some(2),
            }),
            config: ProtocolConfig::JustFloat { channels: Some(2) },
            convert_to: None,
        },
    )
}

/// 被删页签的节点从运行时索引与协议状态同时消失。
#[tokio::test]
async fn remove_tab_graph_removes_nodes_owned_by_that_tab() {
    let state = AppState::new();
    apply_tab_graph(
        &state,
        None,
        "tab1".into(),
        vec![device_node("tp", "tab1"), protocol_node("pt", "tab1")],
        vec![],
        HashMap::default(),
        None,
        None,
    )
    .await
    .expect("提交图应成功");
    assert!(
        state.data_plane.protocol_states.lock().contains_key("pt"),
        "前提: 提交后 protocol_states 含 pt"
    );

    apply_remove_tab_graph(&state, None, "tab1")
        .await
        .expect("移除图应成功");

    assert!(
        state.data_plane.global_nodes.lock().is_empty(),
        "被删页签的节点应一并移除"
    );
    assert!(
        state.data_plane.protocol_states.lock().is_empty(),
        "Protocol 运行时状态应随页签节点清除"
    );
}

/// 其他页签使用独立节点 id，删除页签不会误伤存活页签。
#[tokio::test]
async fn remove_tab_graph_keeps_other_tab_nodes() {
    let state = AppState::new();
    apply_tab_graph(
        &state,
        None,
        "tab1".into(),
        vec![device_node("tp", "tab1"), protocol_node("pt", "tab1")],
        vec![],
        HashMap::default(),
        None,
        None,
    )
    .await
    .expect("提交 tab1 图应成功");
    apply_tab_graph(
        &state,
        None,
        "tab2".into(),
        vec![device_node("tp2", "tab2"), protocol_node("pt2", "tab2")],
        vec![],
        HashMap::default(),
        None,
        None,
    )
    .await
    .expect("提交 tab2 图应成功");

    apply_remove_tab_graph(&state, None, "tab1")
        .await
        .expect("移除图应成功");

    let nodes = state.data_plane.global_nodes.lock();
    assert!(
        nodes.contains_key("tp2") && nodes.contains_key("pt2"),
        "其他页签节点不应被移除"
    );
    assert!(!nodes.contains_key("tp") && !nodes.contains_key("pt"));
    assert_eq!(nodes["pt2"].tab_id, "tab2");
    drop(nodes);
    assert!(
        state.data_plane.protocol_states.lock().contains_key("pt2"),
        "Protocol 运行时状态应保留"
    );
    assert!(
        state.graphs.lock().contains_key("tab2"),
        "存活 tab 的图不受影响"
    );
}

#[tokio::test]
async fn duplicate_node_id_across_tabs_is_rejected() {
    let state = AppState::new();
    apply_tab_graph(
        &state,
        None,
        "tab1".into(),
        vec![device_node("device", "tab1")],
        vec![],
        HashMap::default(),
        None,
        None,
    )
    .await
    .unwrap();

    let result = apply_tab_graph(
        &state,
        None,
        "tab2".into(),
        vec![device_node("device", "tab2")],
        vec![],
        HashMap::default(),
        None,
        None,
    )
    .await;
    assert!(matches!(
        result,
        Err(error::AppError::Config(
            error::ConfigError::DuplicateNode { .. }
        ))
    ));
}

//! 工作区持久化集成测试：每个页签只保存节点文档与连线。

use app::{AppState, collect_workspace_file, save_workspace};
use backend_host::restore_workspace;
use buffer_graph::Edge;
use graph_ops::{apply_connect_edge, apply_document, apply_remove_tab_graph};
use kind::document::{NodeBusiness, NodeDocument, NodeLayout};
use serde_json::json;

fn widget_document(
    id: &str,
    tab_id: &str,
    widget_kind: &str,
    params: serde_json::Value,
    layout: NodeLayout,
) -> NodeDocument {
    NodeDocument {
        id: id.into(),
        tab_id: tab_id.into(),
        label: id.into(),
        layout,
        business: NodeBusiness::Widget {
            widget_kind: widget_kind.into(),
            params,
            custom_ports: None,
        },
    }
}

const fn auto_layout(x: f64, y: f64) -> NodeLayout {
    NodeLayout {
        x,
        y,
        width: None,
        height: None,
    }
}

async fn apply_documents(
    state: &AppState,
    tab_id: &str,
    documents: Vec<NodeDocument>,
    edges: Vec<Edge>,
) {
    apply_document(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        None,
        tab_id.into(),
        documents,
        edges,
        None,
    )
    .await
    .expect("节点文档提交应成功");
}

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("lissio-workspace-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("创建临时目录");
    dir
}

#[tokio::test]
async fn workspace_survives_save_and_restore_roundtrip() {
    let dir = temp_dir("roundtrip");
    let state = AppState::new();
    state.workspace.lock().tabs = vec![app::TabMeta {
        id: "tab1".into(),
        name: "Tab 1".into(),
    }];
    let documents = vec![
        widget_document(
            "w-gauge",
            "tab1",
            "NumberDisplay",
            json!({"min": 0.0, "max": 100.0}),
            NodeLayout {
                x: 12.5,
                y: 40.0,
                width: Some(240.0),
                height: Some(160.0),
            },
        ),
        widget_document(
            "m1",
            "tab1",
            "Math",
            json!({"op": "add", "inputCount": 1}),
            auto_layout(1.0, 2.0),
        ),
    ];
    apply_documents(
        &state,
        "tab1",
        documents,
        vec![Edge {
            id: "e1".into(),
            source: "m1".into(),
            source_handle: "result".into(),
            target: "w-gauge".into(),
            target_handle: "value".into(),
        }],
    )
    .await;

    let file = collect_workspace_file(&state.workspace, &state.source_graphs);
    save_workspace(&dir, &file).expect("落盘应成功");
    assert_eq!(file.graphs["tab1"].documents.len(), 2);

    let fresh = AppState::new();
    assert!(restore_workspace(&fresh, &dir, None).await, "应报告已恢复");
    {
        let ws = fresh.workspace.lock();
        assert!(ws.restored && !ws.dirty, "恢复后不应立即触发重写");
        assert_eq!(ws.tabs.len(), 1);
        assert_eq!(ws.tabs[0].name, "Tab 1");
    }
    let stored = fresh.source_graphs.lock().get("tab1").unwrap().clone();
    assert_eq!(stored.documents.len(), 2);
    assert_eq!(stored.documents[0].layout.width, Some(240.0));
    assert_eq!(stored.edges.len(), 1);
    assert_eq!(stored.widgets.len(), 2, "widget 投影应由文档恢复");
    assert!(fresh.graphs.lock().contains_key("tab1"));
    assert!(
        fresh
            .graphs_version
            .load(std::sync::atomic::Ordering::Relaxed)
            >= 1
    );

    let empty_dir = temp_dir("empty");
    let fresh2 = AppState::new();
    assert!(!restore_workspace(&fresh2, &empty_dir, None).await);
    assert!(!fresh2.workspace.lock().restored);
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&empty_dir);
}

#[tokio::test]
async fn connect_edge_preserves_documents_and_widget_projection() {
    let state = AppState::new();
    apply_documents(
        &state,
        "tab1",
        vec![
            widget_document("in1", "tab1", "Slider", json!({}), auto_layout(0.0, 0.0)),
            widget_document(
                "m1",
                "tab1",
                "Math",
                json!({"op": "add", "inputCount": 1}),
                auto_layout(1.0, 2.0),
            ),
        ],
        vec![],
    )
    .await;

    apply_connect_edge(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        None,
        Some("tab1".into()),
        "in1".into(),
        "m1".into(),
        None,
        None,
    )
    .await
    .expect("连线应成功");

    let stored = state.source_graphs.lock().get("tab1").unwrap().clone();
    assert_eq!(stored.documents.len(), 2);
    assert_eq!(stored.widgets.len(), 2);
    assert_eq!(stored.edges.len(), 1);
    assert!(state.workspace.lock().dirty);
}

#[tokio::test]
async fn remove_tab_graph_discards_its_document() {
    let state = AppState::new();
    apply_documents(
        &state,
        "tab1",
        vec![widget_document(
            "w-gauge",
            "tab1",
            "NumberDisplay",
            json!({}),
            auto_layout(3.0, 4.0),
        )],
        vec![],
    )
    .await;
    assert!(state.source_graphs.lock().contains_key("tab1"));

    apply_remove_tab_graph(&state, None, "tab1")
        .await
        .expect("移除图应成功");
    assert!(!state.source_graphs.lock().contains_key("tab1"));
    assert!(state.workspace.lock().dirty);
}

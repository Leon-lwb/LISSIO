//! 图提交管线测试 — 全走 pub API (apply_tab_graph / apply_*_edge / AppState)
//!
//! 从 `apply.rs` 内嵌测试模块外移 (源文件行数约定 ≤500), 断言语义零变化。

use std::collections::HashMap;

use app::AppState;
use buffer_graph::Edge;
use kind::document::{NodeBusiness, NodeDocument, NodeLayout};
use kind::{NodeDef, NodeKind};
use serde_json::json;

use crate::{
    apply_connect_edge, apply_disconnect_edge, apply_document, apply_remove_tab_graph,
    apply_tab_graph,
};

fn input_node(id: &str, tab_id: &str) -> NodeDef {
    NodeDef::new(id.into(), tab_id.into(), NodeKind::Input)
}

/// update_tab_graph 提交后必须立即快照评估: 无 transport 数据流时,
/// 图/参数变更 (manual Trigger 改 command、Str 内联框编辑等) 也要即时
/// 反映到 output_snapshot (回归: 曾缺 refresh_snapshot 调用)
#[tokio::test]
async fn update_tab_graph_refreshes_snapshot() {
    let state = AppState::new();
    state.input_values.write().insert("in1".into(), 7.0);

    apply_tab_graph(
        &state,
        None,
        "tab1".into(),
        vec![input_node("in1", "tab1")],
        vec![],
        HashMap::new(),
        None,
        None,
    )
    .await
    .expect("提交图应成功");

    let got = state
        .data_plane
        .eval
        .output_snapshot
        .lock()
        .values
        .get("in1")
        .and_then(|ports| ports.get("value"))
        .copied();
    assert_eq!(got, Some(7.0), "提交后应立即快照评估, Input 值立即可见");
}

/// remove_tab_graph 提交后同样立即快照评估: 快照为全量覆盖写,
/// 被删 tab 的节点输出键应立即从快照清除
#[tokio::test]
async fn remove_tab_graph_refreshes_snapshot() {
    let state = AppState::new();
    state.input_values.write().insert("in1".into(), 3.0);
    apply_tab_graph(
        &state,
        None,
        "tab1".into(),
        vec![input_node("in1", "tab1")],
        vec![],
        HashMap::new(),
        None,
        None,
    )
    .await
    .expect("提交图应成功");
    assert!(
        state
            .data_plane
            .eval
            .output_snapshot
            .lock()
            .values
            .contains_key("in1"),
        "前提: 提交后输出已可见"
    );

    apply_remove_tab_graph(&state, None, "tab1")
        .await
        .expect("移除图应成功");

    let cleared = !state
        .data_plane
        .eval
        .output_snapshot
        .lock()
        .values
        .contains_key("in1");
    assert!(cleared, "移除后应立即快照评估, 过期节点键立即清除");
    assert!(
        state.source_graphs.lock().get("tab1").is_none(),
        "tab 移除后源图存储应同步清除"
    );
}

// ---- 源图存储 / 版本冲突 / 拓扑 op ----

fn protocol_node(id: &str, tab_id: &str) -> NodeDef {
    NodeDef::new(
        id.into(),
        tab_id.into(),
        NodeKind::Protocol {
            schema: schema_types::schema_from_protocol_config(
                &schema_types::ProtocolConfig::JustFloat { channels: None },
            ),
            config: schema_types::ProtocolConfig::JustFloat { channels: None },
            convert_to: None,
        },
    )
}

fn math_node(id: &str, tab_id: &str) -> NodeDef {
    NodeDef::new(
        id.into(),
        tab_id.into(),
        NodeKind::Math {
            op: kind::MathOp::Add,
            input_count: 1,
        },
    )
}

fn edge(id: &str, source: &str, sh: &str, target: &str, th: &str) -> Edge {
    Edge {
        id: id.into(),
        source: source.into(),
        source_handle: sh.into(),
        target: target.into(),
        target_handle: th.into(),
    }
}

fn widget_document(
    id: &str,
    tab_id: &str,
    widget_kind: &str,
    params: serde_json::Value,
) -> NodeDocument {
    NodeDocument {
        id: id.into(),
        tab_id: tab_id.into(),
        label: id.into(),
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

fn protocol_document(id: &str, tab_id: &str) -> NodeDocument {
    let protocol = schema_types::ProtocolConfig::JustFloat { channels: None };
    NodeDocument {
        id: id.into(),
        tab_id: tab_id.into(),
        label: id.into(),
        layout: NodeLayout {
            x: 0.0,
            y: 0.0,
            width: None,
            height: None,
        },
        business: NodeBusiness::Protocol {
            protocol: protocol.clone(),
            convert_to: None,
            schema: schema_types::ProtocolSchema {
                preset: schema_types::SchemaPreset::JustFloat,
                preset_config: Some(protocol),
                decode: Vec::new(),
                encode: None,
            },
        },
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

/// 提交成功写入源图存储 + 版本号递增; base_version 过期返回版本冲突
#[tokio::test]
async fn update_tab_graph_writes_source_store_and_checks_version() {
    let state = AppState::new();
    let derived = apply_tab_graph(
        &state,
        None,
        "tab1".into(),
        vec![input_node("in1", "tab1")],
        vec![],
        HashMap::new(),
        None,
        None,
    )
    .await
    .expect("提交图应成功");
    assert_eq!(derived.version, 1, "首次提交版本号应为 1");
    assert_eq!(
        state
            .source_graphs
            .lock()
            .get("tab1")
            .map(|g| g.nodes.len()),
        Some(1),
        "成功提交应写入源图存储"
    );

    // 过期 base_version → GraphVersionConflict (其他写入方推进了版本)
    let err = apply_tab_graph(
        &state,
        None,
        "tab1".into(),
        vec![input_node("in1", "tab1")],
        vec![],
        HashMap::new(),
        None,
        Some(0),
    )
    .await
    .expect_err("过期版本应冲突");
    assert!(
        err.to_string().contains("版本冲突"),
        "应报告版本冲突: {err}"
    );

    // 匹配的 base_version → 成功且版本推进
    let derived = apply_tab_graph(
        &state,
        None,
        "tab1".into(),
        vec![input_node("in1", "tab1")],
        vec![],
        HashMap::new(),
        None,
        Some(1),
    )
    .await
    .expect("匹配版本应成功");
    assert_eq!(derived.version, 2);
}

/// 编译失败必须返回真实 CompileError (域不匹配可读原因), 不再是占位 Cycle 假错误;
/// 且源图存储不变 (提交被整体拒绝)
#[tokio::test]
async fn update_tab_graph_returns_real_compile_error() {
    let state = AppState::new();
    let err = apply_tab_graph(
        &state,
        None,
        "tab1".into(),
        vec![protocol_node("pt", "tab1"), math_node("m1", "tab1")],
        vec![edge("e1", "pt", "out", "m1", "in0")],
        HashMap::new(),
        None,
        None,
    )
    .await
    .expect_err("Protocol.out(bytes) → Math.in0(f32) 应域不匹配");
    let msg = err.to_string();
    assert!(msg.contains("域不匹配"), "真实原因应可见: {msg}");
    assert!(!msg.contains("循环"), "不得回落为占位循环错误: {msg}");
    assert!(
        state.source_graphs.lock().get("tab1").is_none(),
        "失败提交不得写入源图存储"
    );
}

/// connect_edge op: 默认 handle 按端口提示解析、RawData 目标改写 src: 端口、
/// 等价边幂等; 域不匹配被编译拒绝且源图不变
#[tokio::test]
async fn connect_edge_op_validates_and_persists() {
    let state = AppState::new();
    apply_documents(
        &state,
        "tab1",
        vec![
            widget_document("in1", "tab1", "Slider", json!({})),
            widget_document("m1", "tab1", "Math", json!({"op": "add", "inputCount": 1})),
        ],
        vec![],
    )
    .await;

    // 默认 handle: in1.value → m1.in0
    let out = apply_connect_edge(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        None,
        None,
        "in1".into(),
        "m1".into(),
        None,
        None,
    )
    .await
    .expect("默认 handle 连线应成功");
    let stored = state.source_graphs.lock().get("tab1").unwrap().clone();
    assert_eq!(stored.edges.len(), 1);
    assert_eq!(stored.edges[0].source_handle, "value");
    assert_eq!(stored.edges[0].target_handle, "in0");

    // 等价边幂等 — 返回同一边 id, 不重复建边
    let again = apply_connect_edge(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        None,
        None,
        "in1".into(),
        "m1".into(),
        None,
        None,
    )
    .await
    .expect("等价连线应幂等成功");
    assert_eq!(again.edge_id, out.edge_id);
    assert_eq!(
        state.source_graphs.lock().get("tab1").unwrap().edges.len(),
        1
    );

    // 域不匹配: m1.result (f32) → in1 (Input 无输入口, 端口域回退 f32 → 可编译)。
    // 改用明确的域冲突: 新建 protocol + math 再连 out → in0
    apply_documents(
        &state,
        "tab2",
        vec![
            protocol_document("pt", "tab2"),
            widget_document("m2", "tab2", "Math", json!({"op": "add", "inputCount": 1})),
        ],
        vec![],
    )
    .await;
    let err = apply_connect_edge(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        None,
        None,
        "pt".into(),
        "m2".into(),
        None,
        Some("in0".into()),
    )
    .await
    .expect_err("Protocol.out(bytes) → Math.in0(f32) 应被编译拒绝");
    assert!(
        err.to_string().contains("域不匹配"),
        "应回传真实原因: {err}"
    );
    assert_eq!(
        state.source_graphs.lock().get("tab2").unwrap().edges.len(),
        0,
        "编译失败源图不得改变"
    );

    let cross_tab = apply_connect_edge(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        None,
        None,
        "in1".into(),
        "m2".into(),
        None,
        None,
    )
    .await
    .expect_err("跨页签连线必须被拒绝");
    assert!(cross_tab.to_string().contains("禁止跨页签连线"));

    // RawData 目标: 端口提示 raw_data=true → target_handle 改写为 src:<source>:<handle>
    apply_documents(
        &state,
        "tab3",
        vec![
            widget_document("in3", "tab3", "Slider", json!({})),
            widget_document("raw1", "tab3", "RawData", json!({})),
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
        None,
        "in3".into(),
        "raw1".into(),
        None,
        None,
    )
    .await
    .expect("RawData 连线应成功");
    let stored3 = state.source_graphs.lock().get("tab3").unwrap().clone();
    assert_eq!(stored3.edges[0].target_handle, "src:in3:value");
}

/// disconnect_edge op: 按 edge_id 删除并重编译; 未命中返回 GraphEdgeNotFound
#[tokio::test]
async fn disconnect_edge_op_removes_and_reports_miss() {
    let state = AppState::new();
    apply_documents(
        &state,
        "tab1",
        vec![
            widget_document("in1", "tab1", "Slider", json!({})),
            widget_document("m1", "tab1", "Math", json!({"op": "add", "inputCount": 1})),
        ],
        vec![edge("e1", "in1", "value", "m1", "in0")],
    )
    .await;

    let out = apply_disconnect_edge(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        None,
        Some("e1".into()),
        None,
        None,
    )
    .await
    .expect("按 edge_id 删边应成功");
    assert_eq!(out.edge_id, "e1");
    assert_eq!(
        state.source_graphs.lock().get("tab1").unwrap().edges.len(),
        0,
        "删除后源图不应再有该边"
    );

    let err = apply_disconnect_edge(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        None,
        Some("ghost".into()),
        None,
        None,
    )
    .await
    .expect_err("未命中应报错");
    assert!(err.to_string().contains("未找到匹配的连线"));
}

//! 图提交管线测试 — 全走 pub API (apply_tab_graph / apply_*_edge / AppState)
//!
//! 从 `apply.rs` 内嵌测试模块外移 (源文件行数约定 ≤500), 断言语义零变化。

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use app::AppState;
use buffer_graph::Edge;
use error::{AppError, ConfigError};
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

/// 提交一个 tab 图, 与另一个任务在同一起跑线上 (栅栏) 抢同一把提交锁,
/// `base_version` 固定为 0 (与初始版本一致)。
async fn racing_commit(
    state: Arc<AppState>,
    barrier: Arc<tokio::sync::Barrier>,
    tab_id: &'static str,
    node_id: &'static str,
) -> error::Result<crate::GraphDerived> {
    barrier.wait().await;
    apply_tab_graph(
        &state,
        None,
        tab_id.into(),
        vec![input_node(node_id, tab_id)],
        vec![],
        HashMap::new(),
        None,
        Some(0),
    )
    .await
}

/// 回归 (审计 M1 — 提交不是原子的读-改-写): 两个提交共享同一 `base_version` 时,
/// 版本检查与全部状态写入必须在**同一个临界区**内, 于是恰好一个成功、一个报
/// `GraphVersionConflict`, 运行时节点索引只含胜者。
///
/// 反例 (修复前): 两次检查都是普通 `load`, 写入各自持锁且版本号最后才 +1 —
/// 两个提交都能通过检查, 后写者用同一份旧快照覆盖 `global_nodes`, 先写者的页签
/// 节点被静默丢弃 (不再被路由/录制), 版本号却变成 2。
///
/// 确定性: 测试**自己先持有提交锁**, 两个提交因此都停在版本检查之前 —— 这正是
/// 「两个提交带着同一 base_version 同时在场」的确定性构造, 不靠 sleep 撞调度。
/// 持锁期间版本号与三处状态必须一动不动; 放锁后两者在锁上竞争, 结果只有一种:
/// 成功者版本 1、失败者 `current == 1`、索引只含胜者。修复前这个测试必然失败
/// (提交不取这把锁, 两个提交都会在持锁期间跑完并把版本推到 2)。
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_commits_with_the_same_base_version_serialize() {
    let state = Arc::new(AppState::new());
    let barrier = Arc::new(tokio::sync::Barrier::new(2));

    // 先持锁: 两个提交都到不了版本检查 (临界区从取锁开始)。
    let held = state.data_plane.commit_lock().lock().await;
    let first = tokio::spawn(racing_commit(
        Arc::clone(&state),
        Arc::clone(&barrier),
        "tab-a",
        "in-a",
    ));
    let second = tokio::spawn(racing_commit(
        Arc::clone(&state),
        Arc::clone(&barrier),
        "tab-b",
        "in-b",
    ));
    // 有界等两个任务抵达提交入口; 断言与它们是否已抵达无关 (未抵达时版本号
    // 同样是 0), 但已抵达者必须被挡在版本检查之前。
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(
        state.graphs_version.load(Ordering::Relaxed),
        0,
        "持锁期间任何提交都不得通过版本检查或推进版本"
    );
    assert!(
        state.graphs.lock().is_empty() && state.source_graphs.lock().is_empty(),
        "持锁期间不得写入任何提交状态"
    );

    drop(held);
    let outcomes = [
        first.await.expect("提交任务不得 panic"),
        second.await.expect("提交任务不得 panic"),
    ];

    let mut wins = Vec::new();
    let mut conflicts = Vec::new();
    for outcome in outcomes {
        match outcome {
            Ok(derived) => wins.push(derived),
            Err(AppError::Config(ConfigError::GraphVersionConflict { current })) => {
                conflicts.push(current);
            }
            Err(other) => panic!("共享 base_version 的提交只允许成功或版本冲突: {other}"),
        }
    }
    assert_eq!(wins.len(), 1, "必须恰好一个提交成功 (两个都成功即节点丢失)");
    assert_eq!(
        conflicts,
        vec![1],
        "另一个提交必须报 current == 1 的 GraphVersionConflict"
    );
    assert_eq!(wins[0].version, 1, "成功提交把版本恰好推进 1");
    assert_eq!(
        state.graphs_version.load(Ordering::Relaxed),
        1,
        "版本号只允许推进一次 (两个都写就是 2)"
    );

    // 运行时节点索引只含胜者 — 没有丢节点, 也没有两个提交的混合结果。
    let winner = {
        let nodes = state.data_plane.global_nodes.lock();
        assert_eq!(
            nodes.len(),
            1,
            "索引里必须只有胜者的节点: {:?}",
            nodes.keys().collect::<Vec<_>>()
        );
        let (node_id, node) = nodes.iter().next().expect("已断言恰好一个节点");
        (node.tab_id.clone(), node_id.clone())
    };
    assert!(
        matches!(winner.1.as_str(), "in-a" | "in-b"),
        "胜者节点必须是其中一个提交的: {winner:?}"
    );
    assert_eq!(
        state.graphs.lock().keys().collect::<Vec<_>>(),
        vec![&winner.0],
        "页签图只应存在胜者的那张"
    );
    let source_graphs = state.source_graphs.lock();
    assert_eq!(
        source_graphs.keys().collect::<Vec<_>>(),
        vec![&winner.0],
        "源图存储同样只应存在胜者的那张"
    );
    assert_eq!(
        source_graphs.get(&winner.0).map(|graph| graph.nodes.len()),
        Some(1),
        "胜者的源图应完整保留"
    );
}

/// [`apply_remove_tab_graph`] 必须走同一把提交锁 — 它同样是「读运行时索引 →
/// 重建合并字节平面 → 写回」的读-改-写, 而且**没有**版本检查 (审计 M1):
/// 不与提交互斥时, 它会把另一个提交刚写进去的节点连同字节平面一起抹掉。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn remove_tab_graph_takes_the_same_commit_lock() {
    let state = Arc::new(AppState::new());
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

    let held = state.data_plane.commit_lock().lock().await;
    let remover = tokio::spawn({
        let state = Arc::clone(&state);
        async move { apply_remove_tab_graph(&state, None, "tab1").await }
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(
        state.graphs.lock().contains_key("tab1"),
        "持锁期间移除必须被挡在临界区之外"
    );
    assert!(
        state.data_plane.global_nodes.lock().contains_key("in1"),
        "持锁期间运行时节点索引不得被改写"
    );

    drop(held);
    remover
        .await
        .expect("移除任务不得 panic")
        .expect("移除应成功");
    assert!(
        state.graphs.lock().is_empty() && state.source_graphs.lock().is_empty(),
        "移除后页签图与源图都应清除"
    );
    assert!(
        state.data_plane.global_nodes.lock().is_empty(),
        "移除后运行时节点索引应清空"
    );
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

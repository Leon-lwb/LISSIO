//! 图提交核心 — 页签图整体编译提交 / 合并 BytePlan 重建
//!
//! 层级: L3 app。不含任何 `#[tauri::command]`; `app` 参数仅用于可选的事件
//! emit (`None` 供测试与启动恢复静默提交)。

use app::{AppState, SourceGraphs, SourceNodeHint, TabSourceGraph, WidgetRecord, WorkspaceState};
use buffer_graph::Edge;
use data_model::{Error, Result};
use error::ConfigError;
use events::emit_graph_derived;
use pipeline::BytePlan;
use pipeline::DataPlaneState;
use pipeline::data_plane::frame_dispatch;
use pipeline::decoder_feed::sync_decoders_now;
use pipeline::{NodeDef, NodeKind};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::{
    CompileState, GRAPH_SOURCE_EVENT, GraphCompileEvent, GraphDerived, GraphSourceEvent,
    compute_derived, inject_protocol_sources,
};

// ============ 节点图 (后端化重构) ============

/// 用候选运行时节点索引 + 全部页签的字节边重建合并 BytePlan
///
/// 节点 id 在工作区内唯一；任一页签提交后重建共享运行平面。
/// 孤儿节点 (图删除后残留) 的运行时资源由 `DataPlaneState::reconcile` 清理。
fn rebuild_byte_plan(
    graphs: &Arc<parking_lot::Mutex<HashMap<String, pipeline::CompiledGraph>>>,
    candidate: &std::collections::HashMap<String, NodeDef>,
    new_tab: Option<(&str, &pipeline::CompiledGraph)>,
) -> Result<BytePlan> {
    let mut byte_edges: Vec<Edge> = Vec::new();
    {
        let graphs = graphs.lock();
        for (tab_id, g) in graphs.iter() {
            if new_tab.is_some_and(|(id, _)| id == tab_id) {
                continue; // 本 tab 用新图的边
            }
            byte_edges.extend(g.byte_edges());
        }
    }
    if let Some((_, g)) = new_tab {
        byte_edges.extend(g.byte_edges());
    }
    // 合并后的运行时节点索引先建 HIR (边分类应与各页签编译期一致), 再投影字节平面
    let typed = pipeline::TypedGraph::build(candidate.values().cloned(), byte_edges)
        .map_err(|e| Error::Config(ConfigError::BytePlanCompile(Box::new(e))))?;
    BytePlan::build(&typed).map_err(|e| Error::Config(ConfigError::BytePlanCompile(Box::new(e))))
}

/// 更新指定 tab 的节点图 (整体替换 nodes + edges) — Tauri 命令入口在
/// `graph::update_tab_graph`, 本体抽出以便不依赖 Tauri State 地复用与测试
///
/// 两层编译:
/// 1. 本 tab 数值图 CompiledGraph::compile (f32 槽位 + 本 tab BytePlan)
/// 2. 合并字节平面: 以工作区唯一 id 合并所有页签节点与字节边，重算 BytePlan
///    存入 DataPlaneState，并同步 protocol_states
///
/// 任一层编译失败 (循环/端口域不匹配等) 返回真实编译错误, 旧图与旧平面保留。
/// `widgets` 是旧式低层调用生成的运行时投影；正式工作区入口使用
/// [`crate::apply_document`]，由节点文档统一派生投影与布局。
/// `base_version` 提供时做乐观并发检查: 与当前图版本不符返回
/// `GraphVersionConflict` (期间有其他写入方 — 拓扑 op / MCP — 推进了版本)。
/// 提交成功后返回 [`GraphDerived`] (派生端口表 + 新版本号),
/// 同时 emit `graph:derived` 与 `graph:source` (权威源图) 事件给前端。
#[allow(clippy::implicit_hasher)]
#[allow(clippy::too_many_arguments)]
pub async fn apply_tab_graph(
    state: &AppState,
    app: Option<&AppHandle>,
    tab_id: String,
    nodes: Vec<NodeDef>,
    edges: Vec<Edge>,
    node_hints: HashMap<String, SourceNodeHint>,
    widgets: Option<Vec<WidgetRecord>>,
    base_version: Option<u64>,
) -> Result<GraphDerived> {
    let derived = apply_tab_graph_parts(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        app,
        tab_id,
        nodes,
        edges,
        node_hints,
        widgets,
        base_version,
        None,
    )
    .await?;
    state.prune_waveform_snapshots();
    Ok(derived)
}

/// [`apply_tab_graph`] 的部件版 — 只依赖图状态五件套
/// (tab 图表 / 全局版本号 / 数据平面 / 源图存储 / 工作区), 供 MCP server、
/// 拓扑 op 等非 Tauri-State 场景直接复用同一条提交路径。
///
/// 成功后把 `(nodes, edges, hints, widgets)` 写入源图存储，
/// 并 emit `graph:source`; 编译失败所有存储不变。
// 参数类型与 AppState.graphs 字段完全一致 (std hasher), 不做 hasher 泛型化
#[allow(clippy::implicit_hasher)]
#[allow(clippy::too_many_arguments)]
pub async fn apply_tab_graph_parts(
    graphs: &Arc<parking_lot::Mutex<HashMap<String, pipeline::CompiledGraph>>>,
    graphs_version: &Arc<std::sync::atomic::AtomicU64>,
    data_plane: &DataPlaneState,
    source_graphs: &SourceGraphs,
    workspace: &WorkspaceState,
    app: Option<&AppHandle>,
    tab_id: String,
    nodes: Vec<NodeDef>,
    edges: Vec<Edge>,
    node_hints: HashMap<String, SourceNodeHint>,
    widgets: Option<Vec<WidgetRecord>>,
    base_version: Option<u64>,
    documents: Option<Vec<kind::document::NodeDocument>>,
) -> Result<GraphDerived> {
    // 0. 乐观并发检查 — base_version 过期说明期间有其他写入方推进了图,
    //    整图替换会覆盖掉那批变更, 必须拒绝 (前端据此拉取权威源图合并重试)
    if let Some(base) = base_version {
        let current = graphs_version.load(std::sync::atomic::Ordering::Relaxed);
        if current != base {
            return Err(Error::Config(ConfigError::GraphVersionConflict { current }));
        }
    }

    let mut node_ids = std::collections::HashSet::with_capacity(nodes.len());
    for node in &nodes {
        if node.tab_id != tab_id {
            return Err(Error::Config(ConfigError::NodeTabMismatch {
                node_id: node.id.clone(),
                expected: tab_id.clone(),
                actual: node.tab_id.clone(),
            }));
        }
        if !node_ids.insert(node.id.as_str()) {
            return Err(Error::Config(ConfigError::DuplicateNode {
                node_id: node.id.clone(),
                tab_id: tab_id.clone(),
            }));
        }
    }
    {
        let existing = data_plane.global_nodes.lock();
        if let Some(node) = nodes.iter().find(|node| {
            existing
                .get(&node.id)
                .is_some_and(|current| current.tab_id != tab_id)
        }) {
            let owner = existing[&node.id].tab_id.clone();
            return Err(Error::Config(ConfigError::DuplicateNode {
                node_id: node.id.clone(),
                tab_id: owner,
            }));
        }
    }

    // 1. ProtocolSource 自动注入 (后端单一权威 — 前端不再下发 ProtocolSource NodeDef)
    let mut compile_nodes = nodes.clone();
    compile_nodes.extend(inject_protocol_sources(&nodes, &edges));

    // 2. 本 tab 数值图编译 — 失败时构造 `CompileReport` 并 emit `graph:compile` 事件,
    //    真实编译错误原样返回 (占位假错误会吞掉域不匹配等可用原因)
    let compiled =
        match pipeline::CompiledGraph::compile(tab_id.clone(), compile_nodes, edges.clone()) {
            Ok(g) => g,
            Err(e) => {
                let report = error::CompileReport::new(e.clone());
                if let Some(app) = app {
                    let _ = app.emit(
                        crate::GRAPH_COMPILE_EVENT,
                        GraphCompileEvent {
                            tab_id: tab_id.clone(),
                            state: CompileState::Error,
                            queued_seq: 0,
                            report: Some(report),
                        },
                    );
                }
                return Err(Error::Config(ConfigError::GraphCompile(Box::new(e))));
            }
        };

    // 3. 候选运行时节点索引: 移除该 tab 旧节点 → 插入新节点
    // ProtocolSource 是页签数值平面的帧源引用，不参与字节平面，不进运行时索引
    // (避免与所引用的 Protocol 定义同 id 冲突)
    let mut candidate = data_plane.global_nodes.lock().clone();
    candidate.retain(|_, n| n.tab_id != tab_id);
    for n in &nodes {
        if matches!(n.kind, pipeline::NodeKind::ProtocolSource { .. }) {
            continue;
        }
        candidate.insert(n.id.clone(), n.clone());
    }

    // 4. 合并字节平面重建 (失败则不提交任何状态)
    let plan = rebuild_byte_plan(graphs, &candidate, Some((&tab_id, &compiled)))?;

    // 5. 派生数据计算 (本次图变化涉及的全部节点的输出端口表 / 通道数)
    let derived_nodes = compute_derived(&candidate.values().cloned().collect::<Vec<_>>());

    // 6. 提交: 页签图 + 运行时节点索引 + 合并平面 + 版本号 + 源图存储 + 工作区
    graphs.lock().insert(tab_id.clone(), compiled);
    *data_plane.global_nodes.lock() = candidate;
    *data_plane.byte_plan.lock() = plan;
    let version = graphs_version.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    // widget 记录: 提交携带时整体替换, 增量写入方 (拓扑 op / MCP 纯拓扑) 保留现状
    {
        let mut store = source_graphs.lock();
        let widgets = widgets.unwrap_or_else(|| {
            store
                .get(&tab_id)
                .map(|g| g.widgets.clone())
                .unwrap_or_default()
        });
        let documents = documents.unwrap_or_else(|| {
            store
                .get(&tab_id)
                .map(|g| g.documents.clone())
                .unwrap_or_default()
        });
        store.insert(
            tab_id.clone(),
            TabSourceGraph {
                documents,
                nodes,
                edges,
                hints: node_hints,
                widgets,
            },
        );
    };
    workspace.lock().dirty = true;
    sync_recording_bindings(data_plane, source_graphs);

    // 7. 同步 Protocol 节点运行时状态 + FrameDecoder 状态清理 + 孤儿资源清理
    data_plane.sync_protocol_states();
    data_plane.reconcile().await;
    sync_decoders_now(&data_plane.eval.clone());
    evaluator::sync_spectrum_analyzers(&data_plane.eval);
    evaluator::sync_ifft_buffers(&data_plane.eval);

    // 8. 立即快照评估一次: 图结构/参数变更必须即时反映到输出,
    //    不能依赖 transport 数据流 — 无数据流时 manual Trigger 改 command、
    //    Str 节点内联框编辑也要立即出结果 (同 set_input_value 语义)
    frame_dispatch::refresh_snapshot(data_plane);

    let derived = GraphDerived {
        nodes: derived_nodes,
        version,
    };
    if let Some(app) = app {
        emit_graph_derived(app, &derived);
        // 权威源图回推 — 前端画布据此收敛 (多写入方: 前端提交 / 拓扑 op / MCP)。
        // 携带 widget 配置记录与画布位置: 画布按此重建该 tab 完整视图
        // (外部提交的纯 widget 图也可完整渲染)
        let (documents, edges) = source_graphs
            .lock()
            .get(&tab_id)
            .map(|g| (g.documents.clone(), g.edges.clone()))
            .unwrap_or_default();
        let _ = app.emit(
            GRAPH_SOURCE_EVENT,
            GraphSourceEvent {
                tab_id: tab_id.clone(),
                version,
                documents,
                edges,
            },
        );
        let _ = app.emit(
            crate::GRAPH_COMPILE_EVENT,
            GraphCompileEvent {
                tab_id: tab_id.clone(),
                state: CompileState::Ok,
                queued_seq: 0,
                report: None,
            },
        );
    }
    Ok(derived)
}

fn sync_recording_bindings(data_plane: &DataPlaneState, source_graphs: &SourceGraphs) {
    let store = source_graphs.lock();
    let global_nodes = data_plane.global_nodes.lock().clone();
    let mut bindings = HashMap::<recording::PortIdentity, recording::DisplayBinding>::new();
    for graph in store.values() {
        let widgets: HashMap<&str, &str> = graph
            .widgets
            .iter()
            .map(|widget| (widget.id.as_str(), widget.kind.as_str()))
            .collect();
        let nodes: HashMap<&str, &NodeDef> = graph
            .nodes
            .iter()
            .map(|node| (node.id.as_str(), node))
            .collect();
        for edge in &graph.edges {
            let Some(kind) = widgets.get(edge.target.as_str()).copied() else {
                continue;
            };
            let Some(capability) = display_capability(kind) else {
                continue;
            };
            let Some(source) = nodes
                .get(edge.source.as_str())
                .copied()
                .or_else(|| global_nodes.get(&edge.source))
            else {
                continue;
            };
            let port = recording::PortIdentity::new(&edge.source, &edge.source_handle);
            let Some(domain) = recording_domain(source, &edge.source_handle) else {
                continue;
            };
            let id = format!("{}:{}:{}", domain.as_str(), edge.source, edge.source_handle);
            bindings
                .entry(port.clone())
                .or_insert_with(|| recording::DisplayBinding {
                    id,
                    component_id: edge.target.clone(),
                    port,
                    domain,
                    capability,
                });
        }
    }
    if let Err(error) = data_plane
        .eval
        .recording
        .sync_bindings(bindings.into_values().collect())
    {
        log::error!("display recording bindings failed: {error}");
    }
}

fn display_capability(kind: &str) -> Option<recording::BindingCapability> {
    match kind {
        "RawData" => Some(recording::BindingCapability::Raw),
        "TextDisplay" => Some(recording::BindingCapability::Text),
        "Waveform" | "Spectrum" => Some(recording::BindingCapability::Curve),
        "TableView" => Some(recording::BindingCapability::Records),
        "PieChart" | "Image" | "Gauge" | "Progress" | "LED" | "NumberDisplay" | "Label"
        | "Model3D" | "Custom" => Some(recording::BindingCapability::Scalar),
        _ => None,
    }
}

fn recording_domain(source: &NodeDef, handle: &str) -> Option<recording::Domain> {
    if matches!(source.kind, NodeKind::Protocol { .. }) && handle == "str" {
        return Some(recording::Domain::String);
    }
    Some(match pipeline::port_domain(&source.kind, handle, true) {
        pipeline::PortDomain::Points => return None,
        pipeline::PortDomain::Bytes => recording::Domain::Bytes,
        pipeline::PortDomain::String => recording::Domain::String,
        pipeline::PortDomain::Spectrum => recording::Domain::Spectrum,
        pipeline::PortDomain::F32 => recording::Domain::Float,
    })
}

/// 移除指定 tab 的节点图 (tab 删除时调用) — Tauri 命令入口在
/// `graph::remove_tab_graph`, 本体抽出以便复用与测试
pub async fn apply_remove_tab_graph(
    state: &AppState,
    app: Option<&AppHandle>,
    tab_id: &str,
) -> Result<GraphDerived> {
    state.graphs.lock().remove(tab_id);
    // 源图存储同步清除 — tab 已不存在, 权威拓扑与 widget 记录随之失效
    state.source_graphs.lock().remove(tab_id);
    sync_recording_bindings(&state.data_plane, &state.source_graphs);
    state.workspace.lock().dirty = true;

    // 运行时节点索引移除该页签节点 + 重建合并字节平面
    let mut candidate = state.data_plane.global_nodes.lock().clone();
    candidate.retain(|_, n| n.tab_id != tab_id);
    // 在移动 candidate 前计算派生数据 (后置消费者仍需遍历)
    let derived_nodes = compute_derived(&candidate.values().cloned().collect::<Vec<_>>());
    let plan = rebuild_byte_plan(&state.graphs, &candidate, None)?;
    *state.data_plane.global_nodes.lock() = candidate;
    *state.data_plane.byte_plan.lock() = plan;
    let version = state
        .graphs_version
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        + 1;

    state.data_plane.sync_protocol_states();
    state.data_plane.reconcile().await;
    state.prune_waveform_snapshots();
    sync_decoders_now(&state.eval_state());

    // 立即快照评估一次 (同 update_tab_graph): 被删 tab 节点的输出键
    // 随全量覆盖写立即从快照清除, 不依赖 transport 数据流
    frame_dispatch::refresh_snapshot(&state.data_plane);

    let derived = GraphDerived {
        nodes: derived_nodes,
        version,
    };
    if let Some(app) = app {
        emit_graph_derived(app, &derived);
    }
    Ok(derived)
}

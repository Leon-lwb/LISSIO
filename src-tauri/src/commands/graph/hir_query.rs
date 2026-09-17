//! HIR 查询 — Tauri IPC 薄壳。
//!
//! 投影实现已下沉到 [`control_api::graph_hir`] (P3): Web 出口
//! (`rpc-api::graph::get_graph_hir`) 与本命令共用同一份实现, 不复制逻辑。
//! 本文件只保留命令签名 (参数名 / 返回形状与前端契约保持不变)。
//!
//! 层级: L4 cmd — 只做 `State` 借用与命令注册。

use app::AppState;
use data_model::Result;
use tauri::State;

pub use control_api::graph_hir::{GraphHir, HirEdgeClassView, HirEdgeView, HirNodeView};

/// Tauri 命令: 按 tab 拉取 HIR 视图 (供 `compile-results` Tab 渲染)
///
/// 注: `state.graphs` 仅在 `apply_tab_graph` 编译成功时插入 — 编译未完成
/// 或编译失败时返回空表 (前端会保留上次成功的 HIR 显示并展示占位文案).
#[tauri::command]
pub async fn get_graph_hir(state: State<'_, AppState>, tab_id: String) -> Result<GraphHir> {
    Ok(control_api::graph_hir::graph_hir(&state, &tab_id))
}

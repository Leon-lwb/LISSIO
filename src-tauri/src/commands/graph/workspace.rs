//! 工作区命令 — 水合快照读取 / tab 元数据提交
//!
//! widget 配置模型与持久化的后端入口:
//! - `workspace_get`: 前端启动时拉取权威快照 (tabs + data_tabs + 各 tab 源图);
//!   未恢复过持久化工作区时返回 None (前端走默认启动)
//! - `workspace_set_tabs`: 控件 tab 与数据面板 tab 元数据提交 (增删改名后整表覆盖)
//!
//! 快照类型与组装逻辑在 [`app`] (GUI / HTTP-RPC 两个出口共用同一形状); 启动恢复
//! (`workspace.json` 载入 + 逐 tab 重编译) 在
//! [`backend_host::restore_workspace`], GUI 与无界面后端共用同一实现。

use app::AppState;
use app::{DataTabMeta, TabMeta};
use data_model::Result;
use tauri::State;

pub use app::{TabGraphSnapshot, WorkspaceSnapshot};

/// 读取工作区水合快照;启动时未恢复过持久化工作区返回 None。
#[tauri::command]
pub async fn workspace_get(state: State<'_, AppState>) -> Result<Option<WorkspaceSnapshot>> {
    Ok(app::workspace_snapshot(state.inner()).await)
}

/// 提交 tab 元数据 (控件 tab + 数据面板 tab) — 增删/改名/重排后整表覆盖。
#[tauri::command]
pub fn workspace_set_tabs(
    state: State<'_, AppState>,
    tabs: Vec<TabMeta>,
    data_tabs: Vec<DataTabMeta>,
) {
    let mut ws = state.workspace.lock();
    ws.tabs = tabs;
    ws.data_tabs = data_tabs;
    ws.dirty = true;
}

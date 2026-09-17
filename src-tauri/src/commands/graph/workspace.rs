//! 工作区命令 — 水合快照读取 / tab 元数据提交
//!
//! widget 配置模型与持久化的后端入口:
//! - `workspace_get`: 前端启动时拉取权威快照 (tabs + data_tabs + 各 tab 源图 +
//!   widget 记录 + 画布位置);未恢复过持久化工作区时返回 None (前端走默认启动)
//! - `workspace_set_tabs`: 控件 tab 与数据面板 tab 元数据提交 (增删改名后整表覆盖)
//!
//! 启动恢复 (`workspace.json` 载入 + 逐 tab 重编译) 在
//! [`backend_host::restore_workspace`], GUI 与无界面后端共用同一实现。

use app::{DataTabMeta, TabMeta};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::State;

use app::AppState;
use buffer_graph::Edge;
use data_model::Result;

/// `workspace_get` 响应 — 前端水合快照 (图形与 `graph:source` 事件同构,
/// 另带 tab 元数据与全局版本号)
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceSnapshot {
    pub version: u64,
    pub tabs: Vec<TabMeta>,
    pub data_tabs: Vec<DataTabMeta>,
    pub graphs: Vec<TabGraphSnapshot>,
}

/// 单 tab 快照 — 权威源图 + widget 配置记录
#[derive(Debug, Clone, Serialize)]
pub struct TabGraphSnapshot {
    pub documents: Vec<kind::document::NodeDocument>,
    pub tab_id: String,
    pub edges: Vec<Edge>,
}

/// 读取工作区水合快照;启动时未恢复过持久化工作区返回 None。
///
/// 启动恢复在后台任务执行 (不阻塞主线程/事件循环), 此处先 await 恢复完成门,
/// 保证前端水合时工作区已就绪 (恢复失败/无持久化也会放行 → 返回 None, 默认启动)。
/// Tauri 约定: 含引用入参的 async 命令必须返回 Result (恒为 Ok, 仅满足签名)。
#[tauri::command]
pub async fn workspace_get(state: State<'_, AppState>) -> Result<Option<WorkspaceSnapshot>> {
    let mut restore_done = state.subscribe_restore_done();
    while !*restore_done.borrow_and_update() {
        // 发送端丢弃 (AppState 常驻, 理论不发生) 时按未恢复处理
        if restore_done.changed().await.is_err() {
            break;
        }
    }
    let ws = state.workspace.lock();
    if !ws.restored {
        return Ok(None);
    }
    let (tabs, data_tabs) = (ws.tabs.clone(), ws.data_tabs.clone());
    drop(ws);
    let graphs = {
        let store = state.source_graphs.lock();
        // tab 元数据顺序优先, 孤儿源图 (tab 已删但未清理) 按字典序补后
        let mut ordered: Vec<TabGraphSnapshot> = Vec::new();
        for tab in &tabs {
            if let Some(g) = store.get(&tab.id) {
                ordered.push(TabGraphSnapshot {
                    documents: g.documents.clone(),
                    tab_id: tab.id.clone(),
                    edges: g.edges.clone(),
                });
            }
        }
        let mut rest: Vec<&String> = store.keys().collect();
        rest.sort();
        for tab_id in rest {
            if tabs.iter().any(|t| &t.id == tab_id) {
                continue;
            }
            let g = &store[tab_id];
            ordered.push(TabGraphSnapshot {
                documents: g.documents.clone(),
                tab_id: tab_id.clone(),
                edges: g.edges.clone(),
            });
        }
        ordered
    };
    let version = state.graphs_version.load(Ordering::Relaxed);
    Ok(Some(WorkspaceSnapshot {
        version,
        tabs,
        data_tabs,
        graphs,
    }))
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

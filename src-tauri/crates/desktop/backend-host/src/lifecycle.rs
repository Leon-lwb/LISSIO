//! 无界面后端生命周期 — 工作区恢复与会话收尾。
//!
//! 与 Tauri 组合根共用同一份实现: 恢复走 [`graph_ops::apply_document`] 同一提交
//! 路径 (不发事件 — 界面尚未就绪), 收尾停录制并补齐未落盘的工作区变更。

use std::path::Path;

use app::AppState;
use events::BackendEventSink;

/// 启动恢复 — 从 `dir/workspace.json` 载入工作区并逐 tab 重编译。
///
/// 返回是否成功恢复 (文件不存在或损坏返回 false, 调用方据此走空工作区)。
pub async fn restore_workspace(
    state: &AppState,
    dir: &Path,
    sink: Option<&dyn BackendEventSink>,
) -> bool {
    let Some(file) = app::load_workspace(dir) else {
        return false;
    };
    let app::WorkspaceFile {
        tabs,
        data_tabs,
        graphs,
    } = file;
    {
        let mut ws = state.workspace.lock();
        ws.tabs = tabs;
        ws.data_tabs = data_tabs;
        ws.restored = true;
    }
    for (tab_id, g) in graphs {
        let app::TabGraphFile { documents, edges } = g;
        if let Err(e) = graph_ops::apply_document(
            &state.graphs,
            &state.graphs_version,
            &state.data_plane,
            &state.source_graphs,
            &state.workspace,
            sink,
            tab_id,
            documents,
            edges,
            None,
        )
        .await
        {
            // 单 tab 恢复失败 (如图结构已损坏) 不阻塞整体启动 — 该 tab 按空处理
            log::warn!("工作区 tab 图恢复失败: {e}");
        }
    }
    // 启动恢复本身不触发重写 (dirty 由 apply 置位, 此处清零)
    state.workspace.lock().dirty = false;
    true
}

/// 收尾 — 停止录制并把未落盘的工作区变更同步写盘 (幂等)。
pub fn shutdown(state: &AppState, dir: &Path) {
    app::stop_recording(state);
    app::flush_workspace(state, dir);
}

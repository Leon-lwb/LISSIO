//! 工作区存储 — 页签元数据与节点文档的后端权威
//!
//! 每个页签在 [`crate::SourceGraphs`] 中只保存一份 `NodeDocument + Edge`；
//! 运行时 `NodeDef`、端口提示与 widget 投影均由文档派生，不单独持久化。

use buffer_graph::Edge;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 工作区文件名 (位于 app config dir)。
pub const WORKSPACE_FILE_NAME: &str = "workspace.json";

/// 画布布局更新命令的载荷；权威值写入 `NodeDocument.layout`。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
}

impl Position {
    /// 仅坐标 (尺寸未显式调整, 随内容自适应)。
    pub const fn new(x: f64, y: f64) -> Self {
        Self {
            x,
            y,
            width: None,
            height: None,
        }
    }
}

/// 控件 tab 元数据。节点归属和顺序由对应页签的文档决定。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabMeta {
    pub id: String,
    pub name: String,
}

/// 数据面板 tab 元数据 — 透传存储 (面板类型校验在前端水合时做)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataTabMeta {
    pub id: String,
    pub name: String,
    /// 面板类型 (与前端 `DataTabType` 同名透传)
    #[serde(rename = "type")]
    pub tab_type: String,
    #[serde(default = "default_true")]
    pub closable: bool,
    /// 派生面板的宿主 widget id (waveform/raw/... 跟随 widget;独立面板为 None)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub widget_id: Option<String>,
}

const fn default_true() -> bool {
    true
}

/// 工作区内存状态 (锁内)。
///
/// `restored` 标记启动时是否从磁盘恢复过工作区 — `workspace_get` 据此
/// 返回 None (全新安装, 前端走默认启动流程) 或完整快照。
#[derive(Default)]
pub struct WorkspaceInner {
    pub tabs: Vec<TabMeta>,
    pub data_tabs: Vec<DataTabMeta>,
    pub restored: bool,
    /// 自上次落盘后是否有变更 (防抖写入任务 / 退出 flush 的依据)
    pub dirty: bool,
}

/// 工作区存储句柄 — 全局单份 (与 [`crate::SourceGraphs`] 同生命周期)。
pub type WorkspaceState = Arc<parking_lot::Mutex<WorkspaceInner>>;

/// 单 tab 源图的落盘形态 (源图存储的序列化投影)。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TabGraphFile {
    pub documents: Vec<kind::document::NodeDocument>,
    pub edges: Vec<Edge>,
}

/// `workspace.json` 完整形态。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceFile {
    #[serde(default)]
    pub tabs: Vec<TabMeta>,
    #[serde(default)]
    pub data_tabs: Vec<DataTabMeta>,
    #[serde(default)]
    pub graphs: HashMap<String, TabGraphFile>,
}

/// 工作区文件完整路径。
pub fn workspace_path(dir: &Path) -> PathBuf {
    dir.join(WORKSPACE_FILE_NAME)
}

/// 读取工作区文件;文件不存在返回 None,损坏时告警并按不存在处理
/// (降级为全新启动, 下次成功提交会覆盖重写)。
pub fn load_workspace(dir: &Path) -> Option<WorkspaceFile> {
    let path = workspace_path(dir);
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            log::warn!("workspace 读取失败 ({}): {e}", path.display());
            return None;
        }
    };
    match serde_json::from_str(&text) {
        Ok(file) => Some(file),
        Err(e) => {
            log::warn!("workspace 解析失败 ({}): {e}", path.display());
            None
        }
    }
}

/// 写入工作区文件 (全量覆盖)。
///
/// # Errors
/// 目录创建 / 序列化 / 写文件失败时返回 io 错误。
pub fn save_workspace(dir: &Path, file: &WorkspaceFile) -> std::io::Result<()> {
    let path = workspace_path(dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text =
        serde_json::to_string_pretty(file).map_err(|e| std::io::Error::other(e.to_string()))?;
    fs::write(&path, text)
}

/// 从内存状态收集落盘快照。
///
/// 两份状态分别在各自锁内克隆，绝不同时持锁。这样读快照无需依赖其他
/// 调用点的锁序，也不会与源图读取/提交路径形成 AB-BA 死锁。
pub fn collect_workspace_file(
    ws: &WorkspaceState,
    source_graphs: &crate::SourceGraphs,
) -> WorkspaceFile {
    let (tabs, data_tabs) = {
        let ws = ws.lock();
        (ws.tabs.clone(), ws.data_tabs.clone())
    };
    let graphs = source_graphs
        .lock()
        .iter()
        .map(|(tab_id, g)| {
            (
                tab_id.clone(),
                TabGraphFile {
                    documents: g.documents.clone(),
                    edges: g.edges.clone(),
                },
            )
        })
        .collect();
    WorkspaceFile {
        tabs,
        data_tabs,
        graphs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 布局命令载荷可同时表达自适应与显式尺寸。
    #[test]
    fn position_size_roundtrip() {
        let auto = serde_json::to_value(Position::new(1.0, 2.0)).expect("序列化应成功");
        assert_eq!(auto, serde_json::json!({"x": 1.0, "y": 2.0}));

        let sized: Position =
            serde_json::from_str(r#"{"x": 1.0, "y": 2.0, "width": 320, "height": 240}"#)
                .expect("带尺寸格式应可解析");
        assert_eq!(sized.width, Some(320.0));
        assert_eq!(sized.height, Some(240.0));
        let back = serde_json::to_value(sized).expect("序列化应成功");
        assert_eq!(
            back,
            serde_json::json!({"x": 1.0, "y": 2.0, "width": 320.0, "height": 240.0})
        );
    }
}

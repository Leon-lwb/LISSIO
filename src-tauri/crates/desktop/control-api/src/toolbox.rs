//! 工具层共享的应用状态句柄。
//!
//! 曾经的 `Toolbox` 结构体逐字段镜像 `AppState` (17 个字段 + 手工 `from_state`
//! `Arc::clone`), 新增 `AppState` 字段时会静默漏同步。现在所有出口共享同一份
//! [`AppState`] 句柄, 不再有第二份字段清单。

use std::sync::Arc;

use app::AppState;

/// 后端控制工具共享的应用状态句柄
pub type Toolbox = Arc<AppState>;

//! `events` — 前端事件契约 + 后端事件端口
//!
//! 层级: L1 (desktop 域)。本 crate 不依赖 Tauri: 事件名常量、payload 结构与
//! [`BackendEventSink`] 依赖倒置端口在此定义。Tauri 实现 (`TauriEventSink`) 由
//! 桌面组合根注入; 无界面后端注入 [`NullEventSink`] 或 CLI 侧的事件实现。
//!
//! 数据平面读任务 ([`emit_transport_state`] / [`emit_transport_rx`])、图提交
//! ([`emit_graph_derived`])、运行控制 ([`emit_workspace_run`]) 都只依赖端口,
//! 不再把 `tauri::AppHandle` 带进 L1-L3。

use data_model::{ConnectionState, TransportStats};
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

/// `transport:state` 事件名
pub const TRANSPORT_STATE_EVENT: &str = "transport:state";
/// `transport:rx` 事件名 (统计节流推送)
pub const TRANSPORT_RX_EVENT: &str = "transport:rx";
/// `protocol:channels-detected` 事件名 (自动通道检测值变化推送)
pub const PROTOCOL_CHANNELS_DETECTED_EVENT: &str = "protocol:channels-detected";
/// `graph:derived` 事件名 (图编译派生数据 — 节点输出端口表 / 生效通道数, 差分推送)
pub const GRAPH_DERIVED_EVENT: &str = "graph:derived";
/// `graph:compile` event name (编译队列状态广播 — pending / ok / error, 携 receipt_seq)
pub const GRAPH_COMPILE_EVENT: &str = "graph:compile";
/// `workspace:run` 事件名 — 工作区运行状态广播 (state + epoch, 启动/暂停/停止)
pub const WORKSPACE_RUN_EVENT: &str = "workspace:run";

/// 系统通知级别。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotifyLevel {
    /// 普通信息。
    Info,
    /// 错误 (标题标注错误)。
    Error,
}

/// 后端事件端口 — 后端向外 (前端界面 / CLI / 其它宿主) 推送事件与系统通知的
/// 依赖倒置点。
///
/// 实现约定: **失败安全** — 发送失败只记录不向上传播, 不得 panic, 不得在
/// 数据平面热路径上阻塞。
pub trait BackendEventSink: Send + Sync {
    /// 推送一个前端事件 (payload 已序列化为 JSON)。
    fn emit_event(&self, event: &str, payload: Value);
    /// 推送一条系统通知。
    fn notify(&self, level: NotifyLevel, message: &str);
    /// 推送一条带"下载 / 打开链接"的系统通知。
    ///
    /// Web 出口把导出产物挂在 `/api/v1/download/{token}` 上 (浏览器没有可写路径),
    /// 只能靠一条带链接的提示把文件交给用户。不支持链接的出口沿用默认实现, 退化为
    /// 普通通知 — 因此这是端口上的可选能力, 不是契约变更。
    fn notify_with_url(&self, level: NotifyLevel, message: &str, url: &str) {
        let _ = url;
        self.notify(level, message);
    }
}

/// 事件端口共享句柄 — 需要跨任务 (`tokio::spawn`) 持有端口时使用。
pub type EventSinkHandle = Arc<dyn BackendEventSink>;

/// 静默端口 — 无界面后端与测试使用 (丢弃全部事件与通知)。
#[derive(Debug, Clone, Copy, Default)]
pub struct NullEventSink;

impl BackendEventSink for NullEventSink {
    fn emit_event(&self, _event: &str, _payload: Value) {}
    fn notify(&self, _level: NotifyLevel, _message: &str) {}
}

/// `transport:state` payload — 连接状态变化 (携带来源设备节点 id)
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TransportStateEvent {
    pub node_id: String,
    pub state: ConnectionState,
}

/// `transport:rx` payload — 接收统计 (携带来源设备节点 id)
///
/// 注意: 不派生 PartialEq (TransportStats 未实现)。
#[derive(Debug, Clone, Serialize)]
pub struct TransportRxEvent {
    pub node_id: String,
    pub stats: TransportStats,
}

/// 通用事件派发 — payload 序列化失败时静默丢弃 (失败安全)。
pub fn emit_payload<P: Serialize + ?Sized>(sink: &dyn BackendEventSink, event: &str, payload: &P) {
    if let Ok(value) = serde_json::to_value(payload) {
        sink.emit_event(event, value);
    }
}

/// emit `transport:state`
pub fn emit_transport_state(sink: &dyn BackendEventSink, node_id: &str, state: ConnectionState) {
    emit_payload(
        sink,
        TRANSPORT_STATE_EVENT,
        &TransportStateEvent {
            node_id: node_id.to_string(),
            state,
        },
    );
}

/// `protocol:channels-detected` payload — 自动通道检测值变化 (携带来源 Protocol 节点 id)
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProtocolChannelsDetectedEvent {
    pub node_id: String,
    pub channels: usize,
}

/// emit `transport:rx`
pub fn emit_transport_rx(sink: &dyn BackendEventSink, node_id: &str, stats: TransportStats) {
    emit_payload(
        sink,
        TRANSPORT_RX_EVENT,
        &TransportRxEvent {
            node_id: node_id.to_string(),
            stats,
        },
    );
}

/// emit `protocol:channels-detected`
pub fn emit_protocol_channels_detected(
    sink: &dyn BackendEventSink,
    node_id: &str,
    channels: usize,
) {
    emit_payload(
        sink,
        PROTOCOL_CHANNELS_DETECTED_EVENT,
        &ProtocolChannelsDetectedEvent {
            node_id: node_id.to_string(),
            channels,
        },
    );
}

/// `graph:derived` payload — 图编译派生数据 (节点输出端口表 / 生效通道数)
///
/// payload 结构由调用方 (`graph::derived::GraphDerived`) 提供 — 本 crate
/// 不依赖 graph 以避免循环依赖; emit 函数接受任意可序列化的 payload。
/// 调用方约定 payload 形如 `{ "nodes": [{ "node_id": "...", "ports": [...], "effective_channels": N }] }`。
pub fn emit_graph_derived<P: Serialize + ?Sized>(sink: &dyn BackendEventSink, payload: &P) {
    emit_payload(sink, GRAPH_DERIVED_EVENT, payload);
}

/// emit `graph:compile` 事件 payload — 编译队列状态广播.
pub fn emit_graph_compiled<P: Serialize + ?Sized>(sink: &dyn BackendEventSink, payload: &P) {
    emit_payload(sink, GRAPH_COMPILE_EVENT, payload);
}

/// emit `workspace:run` 事件 payload — 工作区运行状态广播.
pub fn emit_workspace_run<P: Serialize + ?Sized>(sink: &dyn BackendEventSink, payload: &P) {
    emit_payload(sink, WORKSPACE_RUN_EVENT, payload);
}

#[cfg(test)]
mod tests;

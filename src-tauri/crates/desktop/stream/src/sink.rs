//! 流推送端口 — 订阅向宿主推送 payload 的唯一定义处。
//!
//! 生产推送路径 (`app::display::spawn_stream`) 与分片推送循环
//! ([`crate::stream::sharded_stream_loop`]) 共用本端口; 组合根注入实现
//! (Tauri `Channel` / WebSocket / stdout), 端口本身不依赖任何宿主 SDK。
//!
//! 与 [`events::BackendEventSink`] 的分工: 那是后端向外推的**事件**
//! (图编译/传输状态), 这里是**数据流** (波形/原始数据/CAN 帧), 携带独立的
//! 订阅 id 与背压语义。

/// 订阅推送的单条 payload — 与 IPC 线上格式一一对应。
#[derive(Debug, Clone)]
pub enum StreamPayload {
    /// JSON 文本 (低频联合事件, serde 序列化结果)。
    Json(String),
    /// 二进制帧 (VNDP/VENV/WWB1, 见 `waveform_binary` 与 `stream::binary`)。
    Binary(Vec<u8>),
}

/// 流推送端口 — 一个逻辑订阅一个实现实例。
///
/// 实现约定: `send` 失败 (对端关闭/序列化不可用) 返回 `false`, 订阅循环
/// 据此退出并清理; 端口实现不得 panic、不得在热路径上无界阻塞。
pub trait StreamSink: Send + Sync + 'static {
    /// 订阅 id — 取消注册 / 背压 ack 的键 (沿用 channel id 语义)。
    fn id(&self) -> u32;
    /// 推送一条 payload; `false` = 订阅应终止。
    fn send(&self, payload: StreamPayload) -> bool;
}

#[cfg(test)]
#[path = "sink_tests.rs"]
mod tests;

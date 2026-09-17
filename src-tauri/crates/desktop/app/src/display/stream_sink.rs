//! 流推送端口 — 显示订阅向宿主 (前端 / CLI) 推送 payload 的依赖倒置点。
//!
//! 层级: L3 app。本模块不依赖 Tauri: 订阅循环只依赖 [`StreamSink`] 端口,
//! Tauri 实现 (`Channel` 适配) 由组合根注入; 无界面宿主 (CLI) 提供自己的
//! 实现 (stdout / 文件)。与 [`events::BackendEventSink`] 的分工: 那是后端
//! 向外推的**事件** (图编译/传输状态), 这里是**显示数据流** (波形/原始数据/
//! CAN 帧), 携带独立的订阅 id 与背压语义。

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
mod tests {
    use super::{StreamPayload, StreamSink};
    use std::sync::Arc;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 记录型端口 — 端口契约测试与无界面测试用。
    #[derive(Default)]
    struct RecordingSink {
        id: AtomicU32,
        payloads: Mutex<Vec<StreamPayload>>,
        pub(crate) fail_after: Option<usize>,
    }

    impl RecordingSink {
        fn new(id: u32) -> Self {
            Self {
                id: AtomicU32::new(id),
                ..Default::default()
            }
        }

        fn payloads(&self) -> Vec<StreamPayload> {
            self.payloads.lock().expect("recording sink lock").clone()
        }
    }

    impl StreamSink for RecordingSink {
        fn id(&self) -> u32 {
            self.id.load(Ordering::Relaxed)
        }

        fn send(&self, payload: StreamPayload) -> bool {
            let mut payloads = self.payloads.lock().expect("recording sink lock");
            if let Some(limit) = self.fail_after
                && payloads.len() >= limit
            {
                return false;
            }
            payloads.push(payload);
            true
        }
    }

    /// 端口契约: id 稳定、payload 原样到达、失败语义可表达。
    #[test]
    fn stream_sink_contract() {
        let sink = Arc::new(RecordingSink::new(7));
        assert_eq!(sink.id(), 7);
        assert!(sink.send(StreamPayload::Json("{\"k\":1}".into())));
        assert!(sink.send(StreamPayload::Binary(vec![1, 2, 3])));
        let payloads = sink.payloads();
        assert_eq!(payloads.len(), 2);
        assert!(matches!(payloads[0], StreamPayload::Json(ref s) if s == "{\"k\":1}"));
        assert!(matches!(payloads[1], StreamPayload::Binary(ref b) if b == &[1, 2, 3]));

        let failing = Arc::new(RecordingSink {
            fail_after: Some(1),
            ..RecordingSink::new(1)
        });
        assert!(failing.send(StreamPayload::Json("{}".into())));
        assert!(!failing.send(StreamPayload::Json("{}".into())));
    }
}

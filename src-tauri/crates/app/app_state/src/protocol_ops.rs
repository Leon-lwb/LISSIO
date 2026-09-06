//! 协议配置运行时操作 — Protocol 节点的换协议/查询 (原 cmd/can_transport 命令体下沉)
//!
//! 层级: L3 app (app_state)。引擎重建与 TestData 断连编排属于应用核心;
//! 引擎工厂在 [`runtime::protocol_factory`] (L2), L1 协议 crate 不被本 crate 直连。

use error::ConfigError;
use notify_events::emit_transport_state;
use schema_types::ProtocolConfig;
use tauri::AppHandle;
use vofa_core::{ConnectionState, Error, Result, TransportConfig};

use crate::app_state::AppState;

impl AppState {
    /// 设置指定 Protocol 节点的协议配置 (运行时覆盖, 重建解析引擎)
    ///
    /// 注意: 图是协议配置的权威来源 — 下次 update_tab_graph 时若图中该节点
    /// 配置与本值不一致, 引擎会按图配置再次重建 (见 DataPlaneState::sync_protocol_states)。
    ///
    /// 如果当前有 TestData 连接, 自动断开 (全部 TestData 节点)。
    /// TestData 生成器只在 `open()` 时接收协议参数, 中连换协议会导致
    /// 生成格式与解析引擎不匹配, 因此强制断连让用户 reconnect。
    pub async fn set_protocol(
        &self,
        app: &AppHandle,
        node_id: &str,
        config: ProtocolConfig,
    ) -> Result<()> {
        // 协议变化 → TestData 生成格式失效: 断开所有打开的 TestData 传输
        {
            let mut manager = self.transport.lock().await;
            let test_nodes: Vec<String> = manager
                .list_open()
                .into_iter()
                .filter(|id| matches!(manager.config(id), Some(TransportConfig::TestData(_))))
                .collect();
            if !test_nodes.is_empty() {
                for id in &test_nodes {
                    self.data_plane.detach(id);
                    manager.close(id);
                    emit_transport_state(app, id, ConnectionState::Disconnected);
                }
                log::info!(
                    "协议切换: 自动断开 TestData 连接 ({} 个), 请重新连接",
                    test_nodes.len()
                );
            }
        }

        let st = self
            .data_plane
            .protocol_states
            .lock()
            .get(node_id)
            .cloned()
            .ok_or_else(|| {
                Error::Config(ConfigError::ProtocolNodeNotFound {
                    node_id: node_id.to_string(),
                })
            })?;
        {
            let mut s = st.lock();
            s.engine =
                std::sync::Arc::new(parking_lot::Mutex::new(runtime::create_engine(&config)));
            s.config = config;
            s.parallel_supported = None;
            s.in_parallel = false;
            s.detection_notified = false;
            s.last_detected_pushed = None;
            s.parallel = std::sync::Arc::new(tokio::sync::Mutex::new(
                data_plane::feed_parallel::ParallelFeeder::new(),
            ));
        }
        // 手动通道数: 直接在后端对齐该源 buffer 通道数
        // (自动模式无需处理: 检测推送记录已重置, 重新检测到值后按变化推送时对齐)
        let manual_channels = st.lock().config.manual_channels();
        if let Some(n) = manual_channels {
            self.data_plane.buffer_for(node_id).lock().set_channels(n);
        }
        Ok(())
    }

    /// 获取指定 Protocol 节点的当前协议配置
    pub async fn get_protocol(&self, node_id: &str) -> Result<ProtocolConfig> {
        let st = self
            .data_plane
            .protocol_states
            .lock()
            .get(node_id)
            .cloned()
            .ok_or_else(|| {
                Error::Config(ConfigError::ProtocolNodeNotFound {
                    node_id: node_id.to_string(),
                })
            })?;
        let config = st.lock().config.clone();
        Ok(config)
    }

    /// 获取自动检测到的通道数 (仅在自动模式下返回 Some, 手动模式返回 None)
    pub async fn get_detected_channels(&self, node_id: &str) -> Result<Option<usize>> {
        let st = self
            .data_plane
            .protocol_states
            .lock()
            .get(node_id)
            .cloned()
            .ok_or_else(|| {
                Error::Config(ConfigError::ProtocolNodeNotFound {
                    node_id: node_id.to_string(),
                })
            })?;
        let engine = st.lock().engine.clone();
        let detected = engine.lock().detected_channels();
        Ok(detected)
    }
}

use data_model::{ConnectionState, TestDataConfig, TransportConfig, TransportStats};
use error::Result;
use error::TransportError;
use flow::{Framing, SourceId};
use schema_types::TestDataLink;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, watch};

use crate::backend::ByteMessage;
use crate::{ConnectionControl, TransportConnection};

/// 单连接句柄 — 一个传输节点实例的全部运行时状态 (crate 内部细节, 经 manager 编排)
///
/// 持有写入通道 / 数据广播 / 取消标志 / 状态 / 统计 / 配置,
/// TestData 传输额外持有链路配置热更新通道 (生成随连接生灭, 无独立运行开关)。
pub struct TransportHandle {
    write_tx: parking_lot::Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    data_tx: broadcast::Sender<ByteMessage>,
    control: Arc<dyn ConnectionControl>,
    state: parking_lot::Mutex<ConnectionState>,
    closed: watch::Sender<bool>,
    stats: Arc<parking_lot::Mutex<TransportStats>>,
    /// 本连接当前实际使用的配置。TestData 热更新采样率时同步更新，供数据平面
    /// 恢复逐样本时间戳，不能只保留打开连接时的旧值。
    /// Arc 包装以便 [`LiveNodeHandle`] 免 manager 全局锁共享读取。
    config: Arc<parking_lot::RwLock<TransportConfig>>,
    connection_epoch: u64,
}

/// 读任务持有的轻量节点句柄 — 拿一次后免 manager 全局锁做每批查询
///
/// 数据平面读任务每批要查运行态配置 (采样时钟) 并上报 rx 统计;
/// 逐批经 manager 全局锁查询会与 open/close/其他传输串行化。此句柄与
/// [`TransportHandle`] 内部字段共享同一 Arc 存储, 克隆廉价; 生命周期上读任务
/// 随连接关闭一同结束 (detach → abort), 不存在句柄悬垂于已重建连接的问题。
pub struct LiveNodeHandle {
    node_id: Arc<str>,
    config: Arc<parking_lot::RwLock<TransportConfig>>,
    stats: Arc<parking_lot::Mutex<TransportStats>>,
}

impl LiveNodeHandle {
    /// 本节点运行态配置 — 仅当查询节点与绑定节点一致时返回。
    /// (协议转换链递归时 source 会变成 Protocol 节点 id, 此时无运行态配置,
    /// 与 `AcquisitionRuntime::config` 对非传输节点返回 None 的语义一致)
    pub fn config_of(&self, node_id: &str) -> Option<TransportConfig> {
        if node_id == &*self.node_id {
            Some(self.config.read().clone())
        } else {
            None
        }
    }

    /// 更新接收统计 (由消费侧在数据被处理完成后上报)
    pub fn record_rx(&self, bytes: usize, frames: u64) {
        let mut stats = self.stats.lock();
        stats.rx_bytes += bytes as u64;
        stats.rx_frames += frames;
    }
}

impl TransportHandle {
    #[allow(clippy::cast_precision_loss)] // Runtime rates are bounded to 5 MHz.
    pub fn set_sample_rate(&self, sample_rate: u32) {
        if let TransportConfig::TestData(config) = &mut *self.config.write() {
            config.sample_rate = sample_rate as f32;
        }
    }
    pub fn close(&self) {
        self.control.close();
        // 显式释放写入端：底层读写任务以 channel 关闭为最终退出条件，
        // 不能依赖整个 SourceSession/NodeEntry 延迟 drop。
        self.write_tx.lock().take();
        self.closed.send_replace(true);
        *self.state.lock() = ConnectionState::Disconnected;
    }

    /// 等待连接被关闭，供监督器观察会话终止。
    pub async fn wait_closed(&self) {
        let mut closed = self.closed.subscribe();
        if *closed.borrow() {
            return;
        }
        while closed.changed().await.is_ok() {
            if *closed.borrow() {
                return;
            }
        }
    }
    pub fn new(
        connection: TransportConnection,
        config: TransportConfig,
        connection_epoch: u64,
    ) -> Self {
        let (closed, _) = watch::channel(false);
        Self {
            write_tx: parking_lot::Mutex::new(Some(connection.write_tx)),
            data_tx: connection.data_tx,
            control: connection.control,
            state: parking_lot::Mutex::new(ConnectionState::Connected),
            closed,
            stats: Arc::new(parking_lot::Mutex::new(TransportStats::default())),
            config: Arc::new(parking_lot::RwLock::new(config)),
            connection_epoch,
        }
    }

    /// 取轻量句柄 (读任务启动时调用一次; node_id 由 manager 的表键提供)
    pub fn live(&self, node_id: &str) -> LiveNodeHandle {
        LiveNodeHandle {
            node_id: Arc::from(node_id),
            config: Arc::clone(&self.config),
            stats: Arc::clone(&self.stats),
        }
    }

    /// 发送数据 (try_send, 队列满时立即报错) 并更新 tx 统计
    ///
    /// 统一回环: 写入任一 Transport 的字节同时以 Transmit 方向发布到本节点的
    /// 接收广播, 使 transport→transport 路由链在写入点不断裂 (发送内容对下游
    /// Protocol/RawData 等订阅者可见, 且方向可辨、不与设备接收混淆)。
    /// 无订阅者时广播失败静默忽略。
    pub fn send(&self, data: &[u8]) -> Result<()> {
        {
            let write_tx = self.write_tx.lock();
            let write_tx = write_tx
                .as_ref()
                .ok_or_else(|| TransportError::Send(std::io::Error::other("channel closed")))?;
            write_tx
                .try_send(data.to_vec())
                .map_err(|_| TransportError::Send(std::io::Error::other("channel closed")))?;
        }
        let _ = self.data_tx.send(ByteMessage::loopback(data.to_vec()));
        {
            let mut stats = self.stats.lock();
            stats.tx_bytes += data.len() as u64;
            stats.tx_frames += 1;
        }
        Ok(())
    }

    /// 订阅接收数据
    pub fn subscribe(&self) -> broadcast::Receiver<ByteMessage> {
        self.data_tx.subscribe()
    }

    pub fn subscribe_flow(&self, source_id: SourceId) -> crate::BroadcastFlowReceiver {
        let framing = match &*self.config.read() {
            TransportConfig::Udp(_) => Framing::Datagram,
            _ => Framing::Stream,
        };
        crate::BroadcastFlowReceiver::new(
            source_id,
            self.connection_epoch,
            framing,
            self.data_tx.subscribe(),
        )
    }

    /// 获取连接状态
    pub fn state(&self) -> ConnectionState {
        *self.state.lock()
    }

    /// 获取统计信息
    pub fn stats(&self) -> TransportStats {
        self.stats.lock().clone()
    }

    /// 本连接的配置 — 供外部查询 CAN 波特率等
    pub fn config(&self) -> TransportConfig {
        self.config.read().clone()
    }

    /// 运行时热更新链路配置 (图/协议变化后调用, 无需重连)
    ///
    /// 当前仅 TestData 生成器消费链路配置; 其他传输类型的字节收发与协议无关,
    /// 静默接受 (返回 false 表示未应用)。
    pub fn update_link(&self, link: TestDataLink, config: Option<TestDataConfig>) -> Result<bool> {
        if let Some(config) = self.control.update_link(link, config)? {
            *self.config.write() = config;
            return Ok(true);
        }
        Ok(false)
    }
}

impl Drop for TransportHandle {
    fn drop(&mut self) {
        // 句柄被移除 (close / 重复 open 替换) 时确保后台任务收到取消信号
        self.control.close();
        self.write_tx.lock().take();
        self.closed.send_replace(true);
    }
}

#[cfg(test)]
#[path = "handle_tests.rs"]
mod tests;

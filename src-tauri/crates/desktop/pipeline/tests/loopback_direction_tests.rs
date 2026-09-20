//! 发送回环方向语义回归测试 (终端回显重复修复)
//!
//! 根因背景: `TransportHandle::send` 统一回环的字节曾以 Receive 方向进入 raw
//! 收集器, 叠加应用层发送路径的显式 Tx 推送, 同一次发送在终端里渲染两次。
//! 现在回环消息携带 Transmit 方向: 读任务按信封方向收集 (发送只进收集器一次),
//! 且合批不跨方向 — 回环与设备接收不会合并成方向歧义的一批。

use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use acquisition::{
    AcquisitionRuntime, ByteMessage, SourceRegistry, TransportBackend, TransportConnection,
};
use app::AppState;
use async_trait::async_trait;
use data_model::device::{DriverId, DriverPayload, EndpointId, EndpointSpec};
use data_model::{Result, SerialConfig, TransportConfig};
use events::NullEventSink;
use raw_data::RawDataDirection;
use schema_types::TestDataLink;
use tokio::sync::{broadcast, mpsc};

/// 静默后端 — 自身不产生设备字节; 测试经保留的广播端手动注入接收数据
struct SilentBackend {
    data_tx_slot: Arc<Mutex<Option<broadcast::Sender<ByteMessage>>>>,
}

#[async_trait]
impl TransportBackend for SilentBackend {
    fn name(&self) -> &'static str {
        "silent"
    }

    fn accepts(&self, _: &TransportConfig) -> bool {
        true
    }

    async fn open(&self, _: TransportConfig, _: TestDataLink) -> Result<TransportConnection> {
        let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(16);
        let (data_tx, _) = broadcast::channel(64);
        *self.data_tx_slot.lock().expect("data_tx_slot") = Some(data_tx.clone());
        let cancel = Arc::new(AtomicBool::new(false));
        let stopped = cancel.clone();
        // 排空写通道, 保持 send 路径不因队列满而失败
        tokio::spawn(async move {
            while !stopped.load(Ordering::SeqCst) {
                tokio::select! {
                    _ = write_rx.recv() => {}
                    () = tokio::time::sleep(Duration::from_millis(5)) => {}
                }
            }
        });
        Ok(TransportConnection::from_cancel_flag(
            write_tx, data_tx, cancel,
        ))
    }
}

fn spec(id: &str) -> EndpointSpec {
    let defaults = serde_json::to_value(TransportConfig::Serial(SerialConfig::default())).unwrap();
    EndpointSpec {
        id: EndpointId(id.into()),
        label: id.into(),
        enabled: true,
        capability_endpoint_id: Some("device".into()),
        driver: DriverPayload {
            driver_id: DriverId("serial".into()),
            schema_version: 1,
            payload: defaults["params"].clone(),
        },
        simulation: None,
    }
}

fn app_state() -> (AppState, Arc<Mutex<Option<broadcast::Sender<ByteMessage>>>>) {
    let slot = Arc::new(Mutex::new(None));
    let registry = Arc::new(SourceRegistry::default());
    registry.register(Arc::new(transport::device_factory::ByteDeviceFactory::new(
        "serial",
        "Serial",
        TransportConfig::Serial(SerialConfig::default()),
        Arc::new(SilentBackend {
            data_tx_slot: slot.clone(),
        }),
    )));
    (
        AppState::with_acquisition(AcquisitionRuntime::new(registry)),
        slot,
    )
}

async fn open_and_attach(state: &AppState, id: &str) {
    state.transport.open_endpoint(spec(id)).await.unwrap();
    state.data_plane.attach(Arc::new(NullEventSink), id).await;
}

/// 轮询等待收集器达到期望块数 (读任务异步处理广播)
async fn wait_for_chunks(plane: &pipeline::DataPlaneState, id: &str, want: usize) {
    let collector = plane.raw_collector_for(id);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    while tokio::time::Instant::now() < deadline {
        if collector.lock().chunk_count() >= want {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("收集器块数未达到 {want}");
}

#[tokio::test]
async fn send_loopback_is_collected_once_as_tx() {
    let (state, _slot) = app_state();
    open_and_attach(&state, "tp").await;

    state.transport.send("tp", b"ls\n").unwrap();
    wait_for_chunks(&state.data_plane, "tp", 1).await;

    let (chunks, _) = state
        .data_plane
        .raw_collector_for("tp")
        .lock()
        .read_from(0, usize::MAX);
    assert_eq!(chunks.len(), 1, "同一次发送只应收集一个 chunk: {chunks:?}");
    assert_eq!(chunks[0].1, RawDataDirection::Tx, "回环应以 Tx 方向收集");
    assert_eq!(chunks[0].2, b"ls\n");
}

#[tokio::test]
async fn loopback_and_device_receive_stay_separate_batches() {
    let (state, slot) = app_state();
    open_and_attach(&state, "tp").await;

    // 1. 发送 (回环 Transmit) → 2. 设备注入接收 (Receive)
    state.transport.send("tp", b"cmd\n").unwrap();
    let data_tx = slot.lock().expect("data_tx_slot").clone().unwrap();
    data_tx
        .send(ByteMessage::from_device(b"resp".to_vec()))
        .unwrap();

    wait_for_chunks(&state.data_plane, "tp", 2).await;

    let (chunks, _) = state
        .data_plane
        .raw_collector_for("tp")
        .lock()
        .read_from(0, usize::MAX);
    assert_eq!(chunks.len(), 2, "方向不同不得合并成一批: {chunks:?}");
    assert_eq!(chunks[0].1, RawDataDirection::Tx);
    assert_eq!(chunks[0].2, b"cmd\n");
    assert_eq!(chunks[1].1, RawDataDirection::Rx);
    assert_eq!(chunks[1].2, b"resp");
}

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

use acquisition::{ByteMessage, TransportBackend, TransportConnection};
use app::AppState;
use async_trait::async_trait;
use data_model::device::{DevicePort, DevicePortDirection, DevicePortDomain, SimulationConfig};
use data_model::device_tree::NodeId;
use data_model::{Result, SerialConfig, TransportConfig};
use events::NullEventSink;
use graph::BytePlan;
use kind::{NodeDef, NodeKind};
use raw_data::RawDataDirection;
use schema_types::{ProtocolConfig, TestDataLink};
use tokio::sync::{broadcast, mpsc};

mod common;

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

fn spec(id: &str) -> data_model::device_tree::NodeDecl {
    let defaults = serde_json::to_value(TransportConfig::Serial(SerialConfig::default())).unwrap();
    common::node(id, "serial", defaults["params"].clone(), None)
}

fn node_id(value: &str) -> NodeId {
    NodeId::new(value).unwrap()
}

fn app_state() -> (AppState, Arc<Mutex<Option<broadcast::Sender<ByteMessage>>>>) {
    let slot = Arc::new(Mutex::new(None));
    let runtime = common::runtime(
        "serial",
        TransportConfig::Serial(SerialConfig::default()),
        Arc::new(SilentBackend {
            data_tx_slot: slot.clone(),
        }),
    );
    (AppState::with_acquisition(runtime), slot)
}

async fn open_and_attach(state: &AppState, id: &str) {
    state.transport.open_node(spec(id)).await.unwrap();
    state.data_plane.attach(Arc::new(NullEventSink), id).await;
    app::apply_workspace_run(
        &state.transport,
        &state.data_plane,
        &state.stream_groups,
        pipeline::RunAction::Start,
    )
    .await;
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

    state.transport.send(&node_id("tp"), b"ls\n").unwrap();
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
    state.transport.send(&node_id("tp"), b"cmd\n").unwrap();
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

#[tokio::test]
async fn pause_drains_real_device_bytes_without_collecting_or_counting_them() {
    let (state, slot) = app_state();
    open_and_attach(&state, "tp").await;
    let data_tx = slot.lock().unwrap().clone().unwrap();
    data_tx
        .send(ByteMessage::from_device(b"before".to_vec()))
        .unwrap();
    wait_for_chunks(&state.data_plane, "tp", 1).await;
    let before = state.transport.stats(&node_id("tp")).unwrap().rx_bytes;

    app::apply_workspace_run(
        &state.transport,
        &state.data_plane,
        &state.stream_groups,
        pipeline::RunAction::Pause,
    )
    .await;
    data_tx
        .send(ByteMessage::from_device(b"paused".to_vec()))
        .unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(
        state
            .data_plane
            .raw_collector_for("tp")
            .lock()
            .chunk_count(),
        1
    );
    assert_eq!(
        state.transport.stats(&node_id("tp")).unwrap().rx_bytes,
        before
    );

    // 立刻恢复，第二条暂停期字节可能还在广播队列中。
    data_tx
        .send(ByteMessage::from_device(b"queued-during-pause".to_vec()))
        .unwrap();

    app::apply_workspace_run(
        &state.transport,
        &state.data_plane,
        &state.stream_groups,
        pipeline::RunAction::Start,
    )
    .await;
    data_tx
        .send(ByteMessage::from_device(b"after".to_vec()))
        .unwrap();
    wait_for_chunks(&state.data_plane, "tp", 2).await;
    let (chunks, _) = state
        .data_plane
        .raw_collector_for("tp")
        .lock()
        .read_from(0, usize::MAX);
    assert_eq!(chunks[1].2, b"after");
}

fn slcan_graph(state: &AppState, source: data_model::device_tree::NodeDecl) {
    let nodes = vec![
        NodeDef {
            id: "tp".into(),
            tab_id: "tab".into(),
            kind: NodeKind::Acquisition {
                node: source,
                ports: vec![DevicePort {
                    id: "rx".into(),
                    direction: DevicePortDirection::Output,
                    domain: DevicePortDomain::Bytes,
                }],
            },
        },
        NodeDef {
            id: "slcan".into(),
            tab_id: "tab".into(),
            kind: NodeKind::Protocol {
                config: ProtocolConfig::Slcan,
                convert_to: None,
                schema: Some(schema_types::ProtocolSchema {
                    preset: schema_types::SchemaPreset::Slcan,
                    legacy_config: Some(ProtocolConfig::Slcan),
                    decode: Vec::new(),
                    encode: None,
                }),
            },
        },
    ];
    let edges = vec![buffer_graph::Edge {
        id: "wire".into(),
        source: "tp".into(),
        source_handle: "rx".into(),
        target: "slcan".into(),
        target_handle: "in".into(),
    }];
    let typed = graph::TypedGraph::build(nodes.clone(), edges).unwrap();
    *state.data_plane.byte_plan.lock() = BytePlan::build(&typed).unwrap();
    *state.data_plane.global_nodes.lock() = nodes.into_iter().map(|n| (n.id.clone(), n)).collect();
    state.data_plane.sync_protocol_states();
}

async fn wait_for_can_frames(state: &AppState, count: usize) -> Vec<can::CanFrame> {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let frames = state.data_plane.can_buffer.lock().get_recent(count);
            if frames.len() >= count {
                return frames;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("CAN frames from device tree")
}

#[tokio::test]
async fn real_and_virtual_device_tree_sources_reach_the_same_slcan_display_buffer() {
    let (real, slot) = app_state();
    let real_source = spec("tp");
    slcan_graph(&real, real_source.clone());
    real.transport.open_node(real_source).await.unwrap();
    real.data_plane.attach(Arc::new(NullEventSink), "tp").await;
    app::apply_workspace_run(
        &real.transport,
        &real.data_plane,
        &real.stream_groups,
        pipeline::RunAction::Start,
    )
    .await;
    let data_tx = slot.lock().unwrap().clone().unwrap();
    data_tx
        .send(ByteMessage::from_device(
            b"t1232AABB\rT1ABCDEFF2CCDD\r".to_vec(),
        ))
        .unwrap();
    let frames = wait_for_can_frames(&real, 2).await;
    assert_eq!(
        (frames[0].id, frames[0].extended, frames[0].data.as_slice()),
        (0x123, false, &[0xAA, 0xBB][..])
    );
    assert_eq!(
        (frames[1].id, frames[1].extended, frames[1].data.as_slice()),
        (0x1ABCDEFF, true, &[0xCC, 0xDD][..])
    );

    let (virtual_state, _) = app_state();
    let defaults = serde_json::to_value(TransportConfig::Serial(SerialConfig::default())).unwrap();
    let simulated = common::node(
        "tp",
        "serial",
        defaults["params"].clone(),
        Some(SimulationConfig {
            sample_rate: 100,
            channels: 1,
            encoding: Some(serde_json::json!({ "protocol": { "kind": "Slcan" }, "schema": null })),
            ..Default::default()
        }),
    );
    slcan_graph(&virtual_state, simulated.clone());
    virtual_state.transport.open_node(simulated).await.unwrap();
    virtual_state
        .data_plane
        .attach(Arc::new(NullEventSink), "tp")
        .await;
    app::apply_workspace_run(
        &virtual_state.transport,
        &virtual_state.data_plane,
        &virtual_state.stream_groups,
        pipeline::RunAction::Start,
    )
    .await;
    let generated = wait_for_can_frames(&virtual_state, 1).await;
    assert!(!generated[0].extended);
    assert_eq!(generated[0].dlc, 8);
    assert_eq!(generated[0].data.len(), 8);
}

#[tokio::test]
async fn resume_discards_an_incomplete_slcan_frame_from_before_pause() {
    let (state, slot) = app_state();
    let source = spec("tp");
    slcan_graph(&state, source.clone());
    state.transport.open_node(source).await.unwrap();
    state.data_plane.attach(Arc::new(NullEventSink), "tp").await;
    app::apply_workspace_run(
        &state.transport,
        &state.data_plane,
        &state.stream_groups,
        pipeline::RunAction::Start,
    )
    .await;
    let tx = slot.lock().unwrap().clone().unwrap();
    tx.send(ByteMessage::from_device(b"t1232AA".to_vec()))
        .unwrap();
    wait_for_chunks(&state.data_plane, "tp", 1).await;
    app::apply_workspace_run(
        &state.transport,
        &state.data_plane,
        &state.stream_groups,
        pipeline::RunAction::Pause,
    )
    .await;
    tx.send(ByteMessage::from_device(b"BB\r".to_vec())).unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(state.data_plane.can_buffer.lock().get_recent(1).is_empty());
    app::apply_workspace_run(
        &state.transport,
        &state.data_plane,
        &state.stream_groups,
        pipeline::RunAction::Start,
    )
    .await;
    tx.send(ByteMessage::from_device(b"t4561CC\r".to_vec()))
        .unwrap();
    let frames = wait_for_can_frames(&state, 1).await;
    assert_eq!(frames[0].id, 0x456);
    assert_eq!(frames[0].data.as_slice(), &[0xCC]);
}

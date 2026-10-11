//! One registry owns real and simulated byte sessions.
use acquisition::{AcquisitionRunState, AcquisitionRuntime, TransportBackend, TransportConnection};
use async_trait::async_trait;
use data_model::device_tree::NodeRole;
use data_model::device_tree::{NodeDecl, NodeId, SIMULATION_DRIVER_ID};
use data_model::{
    SerialConfig, TransportConfig,
    device::{SimulationConfig, TestWaveform},
};
use device_tree::{DeviceTreeAcquisition, DriverRegistry};
use flow::Direction;
use schema_types::TestDataLink;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::sync::{broadcast, mpsc};
use transport::device_driver::ByteDeviceDriver;

struct MemoryBackend(Arc<AtomicUsize>);
#[async_trait]
impl TransportBackend for MemoryBackend {
    fn name(&self) -> &'static str {
        "memory"
    }
    fn accepts(&self, _: &TransportConfig) -> bool {
        true
    }
    async fn open(
        &self,
        _: TransportConfig,
        _: TestDataLink,
    ) -> error::Result<TransportConnection> {
        self.0.fetch_add(1, Ordering::SeqCst);
        let (tx, mut rx) = mpsc::channel(16);
        let (data, _) = broadcast::channel(16);
        let cancel = Arc::new(AtomicBool::new(false));
        let stopped = cancel.clone();
        tokio::spawn(async move {
            while !stopped.load(Ordering::SeqCst) {
                tokio::select! { _ = rx.recv() => {}, () = tokio::time::sleep(Duration::from_millis(1)) => {} }
            }
        });
        Ok(TransportConnection::from_cancel_flag(tx, data, cancel))
    }
}

struct SlowBackend(Arc<AtomicBool>);

#[async_trait]
impl TransportBackend for SlowBackend {
    fn name(&self) -> &'static str {
        "slow-memory"
    }
    fn accepts(&self, _: &TransportConfig) -> bool {
        true
    }
    async fn open(
        &self,
        _: TransportConfig,
        _: TestDataLink,
    ) -> error::Result<TransportConnection> {
        tokio::time::sleep(Duration::from_millis(40)).await;
        let (tx, _rx) = mpsc::channel(1);
        let (data, _) = broadcast::channel(1);
        Ok(TransportConnection::from_cancel_flag(
            tx,
            data,
            self.0.clone(),
        ))
    }
}

fn setup() -> (AcquisitionRuntime, Arc<AtomicUsize>) {
    let opens = Arc::new(AtomicUsize::new(0));
    let registry = Arc::new(DriverRegistry::new());
    let execution = acquisition::ExecutionGate::new(AcquisitionRunState::Stopped);
    registry
        .register(Arc::new(ByteDeviceDriver::new(
            "serial",
            "Serial",
            TransportConfig::Serial(SerialConfig::default()),
            Arc::new(MemoryBackend(opens.clone())),
            NodeRole::Bus,
            execution.clone(),
        )))
        .unwrap();
    (
        AcquisitionRuntime::new(Arc::new(DeviceTreeAcquisition::with_execution(
            registry, execution,
        ))),
        opens,
    )
}

fn spec(id: &str, simulate: bool) -> NodeDecl {
    let defaults = serde_json::to_value(TransportConfig::Serial(SerialConfig::default())).unwrap();
    let mut node = NodeDecl::leaf(id, id, "serial", 1, defaults["params"].clone()).unwrap();
    node.capability_endpoint_id = Some("device".into());
    if simulate {
        let simulation = SimulationConfig {
            channels: 2,
            encoding: Some(
                serde_json::json!({"protocol": {"kind": "JustFloat", "channels": 2}, "schema": null}),
            ),
            ..Default::default()
        };
        node.children.push(
            NodeDecl::leaf(
                format!("{id}::simulation"),
                "simulation",
                SIMULATION_DRIVER_ID,
                1,
                serde_json::to_value(simulation).unwrap(),
            )
            .unwrap(),
        );
    }
    node
}

fn id(value: &str) -> NodeId {
    NodeId::new(value).unwrap()
}

fn update_simulation(node: &mut NodeDecl, update: impl FnOnce(&mut SimulationConfig)) {
    let value = &mut node
        .children
        .iter_mut()
        .find(|child| child.driver.as_str() == SIMULATION_DRIVER_ID)
        .expect("simulation child")
        .config;
    let mut config: SimulationConfig = serde_json::from_value(value.clone()).unwrap();
    update(&mut config);
    *value = serde_json::to_value(config).unwrap();
}

#[tokio::test]
async fn independent_sessions_send_receive_close_and_reconnect() {
    let (runtime, opens) = setup();
    runtime.open_node(spec("a", false)).await.unwrap();
    runtime.open_node(spec("b", false)).await.unwrap();
    let mut rx = runtime.subscribe_flow(&id("a")).unwrap();
    runtime.send(&id("a"), &[1, 2, 3]).unwrap();
    let first = rx.recv().await.unwrap();
    assert_eq!(runtime.stats(&id("a")).unwrap().tx_bytes, 3);
    assert_eq!(runtime.stats(&id("b")).unwrap().tx_bytes, 0);
    assert!(matches!(
        runtime.open_node(spec("a", false)).await,
        Err(acquisition::AcquisitionError::Busy)
    ));
    runtime.close(&id("a")).await;
    runtime.open_node(spec("a", false)).await.unwrap();
    let mut next = runtime.subscribe_flow(&id("a")).unwrap();
    runtime.send(&id("a"), &[4]).unwrap();
    assert!(next.recv().await.unwrap().connection_epoch > first.connection_epoch);
    runtime.reconcile(&[]).await;
    assert!(runtime.list_open().is_empty());
    assert_eq!(opens.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn simulation_is_parseable_and_never_opens_or_writes_hardware() {
    let (runtime, opens) = setup();
    runtime.set_run_state(AcquisitionRunState::Running);
    runtime.open_node(spec("a", true)).await.unwrap();
    assert!(runtime.send(&id("a"), &[1]).is_err());
    let mut rx = runtime.subscribe_bytes(&id("a")).unwrap();
    let message = tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(message.direction, Direction::Receive);
    assert_eq!(message.bytes.len(), 12);
    assert_eq!(&message.bytes[8..], &[0, 0, 128, 127]);
    assert_eq!(opens.load(Ordering::SeqCst), 0);
    runtime.close(&id("a")).await;
}

#[tokio::test]
async fn seeded_simulation_is_reproducible() {
    let (runtime, _) = setup();
    runtime.set_run_state(AcquisitionRunState::Running);
    let mut config = spec("repeat", true);
    update_simulation(&mut config, |simulation| {
        simulation.signal.waveform = TestWaveform::Random;
    });
    let mut frames = Vec::new();
    for _ in 0..2 {
        runtime.open_node(config.clone()).await.unwrap();
        let mut rx = runtime.subscribe_bytes(&id("repeat")).unwrap();
        frames.push(
            tokio::time::timeout(Duration::from_secs(1), rx.recv())
                .await
                .unwrap()
                .unwrap()
                .bytes,
        );
        runtime.close(&id("repeat")).await;
    }
    assert_eq!(frames[0], frames[1]);
}

#[tokio::test]
async fn simulation_requires_encoding_and_only_stopped_halts_it() {
    let (runtime, _) = setup();
    let mut config = spec("a", true);
    update_simulation(&mut config, |simulation| {
        simulation.encoding = None;
    });
    assert!(runtime.open_node(config).await.is_err());
    runtime.open_node(spec("a", true)).await.unwrap();
    let mut rx = runtime.subscribe_bytes(&id("a")).unwrap();
    // 停止态不产数据
    assert!(
        tokio::time::timeout(Duration::from_millis(30), rx.recv())
            .await
            .is_err()
    );
    runtime.set_run_state(AcquisitionRunState::Running);
    assert!(
        tokio::time::timeout(Duration::from_secs(1), rx.recv())
            .await
            .is_ok()
    );
    // 暂停只停发送: 模拟源照常产出, 数据链继续写入缓存
    runtime.set_run_state(AcquisitionRunState::Paused);
    while rx.try_recv().is_ok() {}
    assert!(
        tokio::time::timeout(Duration::from_secs(1), rx.recv())
            .await
            .is_ok(),
        "暂停期间模拟源必须继续产字节"
    );
    // 停止才是硬门控: 等在途一批收尾后排空, 之后不应再有新字节
    runtime.set_run_state(AcquisitionRunState::Stopped);
    tokio::time::sleep(Duration::from_millis(50)).await;
    while rx.try_recv().is_ok() {}
    assert!(
        tokio::time::timeout(Duration::from_millis(60), rx.recv())
            .await
            .is_err()
    );
    runtime.set_run_state(AcquisitionRunState::Running);
    assert!(
        tokio::time::timeout(Duration::from_secs(1), rx.recv())
            .await
            .is_ok()
    );
    runtime.close(&id("a")).await;
}

#[tokio::test]
async fn parameter_edits_are_live_but_structure_edits_disconnect() {
    let (runtime, opens) = setup();
    let mut config = spec("a", true);
    runtime.open_node(config.clone()).await.unwrap();
    update_simulation(&mut config, |simulation| {
        simulation.signal.amplitude = 5.0;
    });
    assert!(runtime.reconcile(&[config.clone()]).await.is_empty());
    update_simulation(&mut config, |simulation| {
        simulation.channels = 3;
    });
    assert_eq!(runtime.reconcile(&[config.clone()]).await, vec![id("a")]);
    assert!(runtime.reconcile(&[config]).await.is_empty());
    assert!(runtime.list_open().is_empty());
    assert_eq!(opens.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn closing_an_opening_session_prevents_late_installation() {
    let closed = Arc::new(AtomicBool::new(false));
    let registry = Arc::new(DriverRegistry::new());
    let execution = acquisition::ExecutionGate::new(AcquisitionRunState::Stopped);
    registry
        .register(Arc::new(ByteDeviceDriver::new(
            "serial",
            "Serial",
            TransportConfig::Serial(SerialConfig::default()),
            Arc::new(SlowBackend(closed.clone())),
            NodeRole::Bus,
            execution.clone(),
        )))
        .unwrap();
    let runtime = Arc::new(AcquisitionRuntime::new(Arc::new(
        DeviceTreeAcquisition::with_execution(registry, execution),
    )));
    let opening = {
        let runtime = runtime.clone();
        tokio::spawn(async move { runtime.open_node(spec("opening", false)).await })
    };
    tokio::time::sleep(Duration::from_millis(5)).await;
    runtime.close(&id("opening")).await;
    assert!(matches!(
        opening.await.unwrap(),
        Err(acquisition::AcquisitionError::Closed)
    ));
    assert!(runtime.list_open().is_empty());
    assert!(
        closed.load(Ordering::SeqCst),
        "late session must be closed before it can publish data"
    );
}

#[tokio::test]
async fn disabled_simulation_child_keeps_the_real_device_open() {
    let (runtime, opens) = setup();
    let mut node = spec("real", true);
    node.children[0].enabled = false;
    runtime.open_node(node).await.unwrap();
    assert_eq!(opens.load(Ordering::SeqCst), 1);
    assert!(runtime.send(&id("real"), &[1]).is_ok());
    runtime.close_node(&id("real")).await.unwrap();
}

//! One registry owns real and simulated byte sessions.
use acquisition::{
    AcquisitionRunState, AcquisitionRuntime, SourceRegistry, TransportBackend, TransportConnection,
};
use async_trait::async_trait;
use data_model::{
    device::{DriverId, DriverPayload, EndpointId, EndpointSpec, SimulationConfig, TestWaveform},
    SerialConfig, TransportConfig,
};
use schema_types::TestDataLink;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{broadcast, mpsc};
use transport::device_factory::ByteDeviceFactory;

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
    ) -> data_model::Result<TransportConnection> {
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
    ) -> data_model::Result<TransportConnection> {
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
    let registry = Arc::new(SourceRegistry::default());
    registry.register(Arc::new(ByteDeviceFactory::new(
        "serial",
        "Serial",
        TransportConfig::Serial(SerialConfig::default()),
        Arc::new(MemoryBackend(opens.clone())),
    )));
    (AcquisitionRuntime::new(registry), opens)
}

fn spec(id: &str, simulate: bool) -> EndpointSpec {
    let defaults = serde_json::to_value(TransportConfig::Serial(SerialConfig::default())).unwrap();
    EndpointSpec { id: EndpointId(id.into()), label: id.into(), enabled: true, capability_endpoint_id: Some("device".into()),
        driver: DriverPayload { driver_id: DriverId("serial".into()), schema_version: 1, payload: defaults["params"].clone() },
        simulation: simulate.then(|| SimulationConfig { channels: 2, encoding: Some(serde_json::json!({"protocol": {"kind": "JustFloat", "channels": 2}, "schema": null})), ..Default::default() }),
    }
}

#[tokio::test]
async fn independent_sessions_send_receive_close_and_reconnect() {
    let (runtime, opens) = setup();
    runtime.open_endpoint(spec("a", false)).await.unwrap();
    runtime.open_endpoint(spec("b", false)).await.unwrap();
    let mut rx = runtime.subscribe_flow("a").unwrap();
    runtime.send("a", &[1, 2, 3]).unwrap();
    let first = rx.recv().await.unwrap();
    assert_eq!(runtime.stats("a").unwrap().tx_bytes, 3);
    assert_eq!(runtime.stats("b").unwrap().tx_bytes, 0);
    assert!(matches!(
        runtime.open_endpoint(spec("a", false)).await,
        Err(acquisition::AcquisitionError::Busy)
    ));
    runtime.close("a").await;
    runtime.open_endpoint(spec("a", false)).await.unwrap();
    let mut next = runtime.subscribe_flow("a").unwrap();
    runtime.send("a", &[4]).unwrap();
    assert!(next.recv().await.unwrap().connection_epoch > first.connection_epoch);
    runtime.reconcile(&[]).await;
    assert!(runtime.list_open().is_empty());
    assert_eq!(opens.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn simulation_is_parseable_and_never_opens_or_writes_hardware() {
    let (runtime, opens) = setup();
    runtime.set_run_state(AcquisitionRunState::Running);
    runtime.open_endpoint(spec("a", true)).await.unwrap();
    assert!(runtime.send("a", &[1]).is_err());
    let mut rx = runtime.subscribe_bytes("a").unwrap();
    let bytes = tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(bytes.len(), 12);
    assert_eq!(&bytes[8..], &[0, 0, 128, 127]);
    assert_eq!(opens.load(Ordering::SeqCst), 0);
    runtime.close("a").await;
}

#[tokio::test]
async fn seeded_simulation_is_reproducible() {
    let (runtime, _) = setup();
    runtime.set_run_state(AcquisitionRunState::Running);
    let mut config = spec("repeat", true);
    config.simulation.as_mut().unwrap().signal.waveform = TestWaveform::Random;
    let mut frames = Vec::new();
    for _ in 0..2 {
        runtime.open_endpoint(config.clone()).await.unwrap();
        let mut rx = runtime.subscribe_bytes("repeat").unwrap();
        frames.push(
            tokio::time::timeout(Duration::from_secs(1), rx.recv())
                .await
                .unwrap()
                .unwrap(),
        );
        runtime.close("repeat").await;
    }
    assert_eq!(frames[0], frames[1]);
}

#[tokio::test]
async fn simulation_requires_encoding_and_pauses_without_catching_up() {
    let (runtime, _) = setup();
    let mut config = spec("a", true);
    config.simulation.as_mut().unwrap().encoding = None;
    assert!(runtime.open_endpoint(config).await.is_err());
    runtime.open_endpoint(spec("a", true)).await.unwrap();
    let mut rx = runtime.subscribe_bytes("a").unwrap();
    assert!(tokio::time::timeout(Duration::from_millis(30), rx.recv())
        .await
        .is_err());
    runtime.set_run_state(AcquisitionRunState::Running);
    assert!(tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .is_ok());
    runtime.set_run_state(AcquisitionRunState::Paused);
    while rx.try_recv().is_ok() {}
    assert!(tokio::time::timeout(Duration::from_millis(30), rx.recv())
        .await
        .is_err());
    runtime.set_run_state(AcquisitionRunState::Running);
    assert!(tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .is_ok());
    runtime.close("a").await;
}

#[tokio::test]
async fn parameter_edits_are_live_but_structure_edits_disconnect() {
    let (runtime, opens) = setup();
    let mut config = spec("a", true);
    runtime.open_endpoint(config.clone()).await.unwrap();
    config.simulation.as_mut().unwrap().signal.amplitude = 5.0;
    assert!(runtime.reconcile(&[config.clone()]).await.is_empty());
    config.simulation.as_mut().unwrap().channels = 3;
    assert_eq!(runtime.reconcile(&[config.clone()]).await, vec!["a"]);
    assert!(runtime.reconcile(&[config]).await.is_empty());
    assert!(runtime.list_open().is_empty());
    assert_eq!(opens.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn closing_an_opening_session_prevents_late_installation() {
    let closed = Arc::new(AtomicBool::new(false));
    let registry = Arc::new(SourceRegistry::default());
    registry.register(Arc::new(ByteDeviceFactory::new(
        "serial",
        "Serial",
        TransportConfig::Serial(SerialConfig::default()),
        Arc::new(SlowBackend(closed.clone())),
    )));
    let runtime = Arc::new(AcquisitionRuntime::new(registry));
    let opening = {
        let runtime = runtime.clone();
        tokio::spawn(async move { runtime.open_endpoint(spec("opening", false)).await })
    };
    tokio::time::sleep(Duration::from_millis(5)).await;
    runtime.close("opening").await;
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

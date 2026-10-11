//! End-to-end `slcan -> can-channel -> isotp -> diagnostic` device-tree chain.

use acquisition::{
    AcquisitionRunState, ByteMessage, ConnectionControl, ExecutionGate, TransportBackend,
    TransportConnection,
};
use async_trait::async_trait;
use data_model::device_tree::NodeRole;
use data_model::device_tree::{DeviceTreeDocument, NodeDecl, NodeId, NodeState};
use data_model::{SlcanConfig, TransportConfig};
use device_tree::{DeviceTree, DeviceTreeRuntime, DriverRegistry};
use error::{AppError as Error, Result};
use schema_types::TestDataLink;
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use transport::device_driver::ByteDeviceDriver;

struct LoopbackCanTransport {
    cancel: Arc<AtomicBool>,
}

struct LoopbackControl {
    cancel: Arc<AtomicBool>,
}

impl ConnectionControl for LoopbackControl {
    fn close(&self) {
        self.cancel.store(true, Ordering::Release);
    }
}

#[async_trait]
impl TransportBackend for LoopbackCanTransport {
    fn name(&self) -> &'static str {
        "test-slcan-loopback"
    }

    fn accepts(&self, config: &TransportConfig) -> bool {
        matches!(config, TransportConfig::Slcan(_))
    }

    async fn open(
        &self,
        _config: TransportConfig,
        _link: TestDataLink,
    ) -> Result<TransportConnection> {
        let (write_tx, mut write_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let (data_tx, _) = tokio::sync::broadcast::channel::<ByteMessage>(64);
        let cancel = self.cancel.clone();
        let outgoing = data_tx.clone();
        tokio::spawn(async move {
            while !cancel.load(Ordering::Acquire) {
                match tokio::time::timeout(std::time::Duration::from_millis(10), write_rx.recv())
                    .await
                {
                    Ok(Some(_request)) => {
                        let _ = outgoing.send(ByteMessage::from_device(b"t7E82017E\r".to_vec()));
                    }
                    Ok(None) => break,
                    Err(_) => {}
                }
            }
        });
        Ok(TransportConnection::new(
            write_tx,
            data_tx,
            Arc::new(LoopbackControl {
                cancel: self.cancel.clone(),
            }),
        ))
    }
}

fn transport_params() -> Value {
    serde_json::to_value(TransportConfig::Slcan(SlcanConfig::default()))
        .expect("slcan config serializes")["params"]
        .clone()
}

fn child(id: &str, driver: &str, config: Value) -> NodeDecl {
    NodeDecl::leaf(id, id, driver, 1, config).expect("valid child node")
}

fn chain_document() -> NodeDecl {
    let mut root = child("slcan", "test-slcan", transport_params());
    let mut can = child("can", "can-channel", json!({"encoding": "slcan"}));
    let mut isotp = child(
        "isotp",
        "isotp",
        serde_json::to_value(automotive_isotp::IsoTpNodeConfig::default())
            .expect("isotp config serializes"),
    );
    isotp.children.push(child(
        "diagnostic",
        "diagnostic",
        serde_json::to_value(automotive_diag::DiagnosticNodeConfig::default())
            .expect("diagnostic config serializes"),
    ));
    can.children.push(isotp);
    root.children.push(can);
    root
}

async fn runtime() -> DeviceTreeRuntime {
    let registry = Arc::new(DriverRegistry::new());
    let execution = ExecutionGate::new(AcquisitionRunState::Running);
    registry
        .register(Arc::new(ByteDeviceDriver::new(
            "test-slcan",
            "Test Slcan",
            TransportConfig::Slcan(SlcanConfig::default()),
            Arc::new(LoopbackCanTransport {
                cancel: Arc::new(AtomicBool::new(false)),
            }),
            NodeRole::Bus,
            execution.clone(),
        )))
        .expect("register byte parent");
    registry
        .register(Arc::new(automotive::CanChannelDriver::new()))
        .expect("register CAN channel");
    registry
        .register(Arc::new(automotive_isotp::IsoTpNodeDriver::new()))
        .expect("register ISO-TP");
    registry
        .register(Arc::new(automotive_diag::DiagnosticNodeDriver::new()))
        .expect("register diagnostic");
    let _ = execution;
    DeviceTree::new(registry)
        .open(DeviceTreeDocument::new(chain_document()))
        .await
        .expect("open diagnostic chain")
}

#[tokio::test]
async fn can_isotp_diagnostic_form_parent_child_chain() {
    let runtime = runtime().await;
    let snapshots = runtime.snapshots();
    assert_eq!(snapshots.len(), 4);
    for id in ["slcan", "can", "isotp", "diagnostic"] {
        let snapshot = snapshots
            .iter()
            .find(|snapshot| snapshot.node_id.as_str() == id)
            .expect("node snapshot");
        assert!(
            matches!(snapshot.state, NodeState::Online { .. }),
            "{id} should be online: {:?}",
            snapshot.state
        );
    }
    assert_eq!(
        snapshots
            .iter()
            .filter(|snapshot| snapshot.capabilities.invoke)
            .count(),
        1
    );

    let diagnostic = runtime
        .runtime(&NodeId::new("diagnostic").expect("node id"))
        .expect("diagnostic runtime");
    let response = diagnostic
        .as_invoker()
        .expect("diagnostic invoke capability")
        .invoke("request", json!({"data": [0x3e]}))
        .await
        .expect("UDS request over ISO-TP");
    assert_eq!(response, json!({"data": [0x7e]}));

    runtime.close().await.expect("close diagnostic chain");
    runtime.close().await.expect("close remains idempotent");
}

#[tokio::test]
async fn diagnostic_rejects_unknown_method_and_bad_payload() {
    let runtime = runtime().await;
    let diagnostic = runtime
        .runtime(&NodeId::new("diagnostic").expect("node id"))
        .expect("diagnostic runtime");
    let invoke = diagnostic
        .as_invoker()
        .expect("diagnostic invoke capability");

    assert!(invoke.invoke("unknown", json!({})).await.is_err());
    assert!(
        invoke
            .invoke("request", json!({"data": [256]}))
            .await
            .is_err()
    );
    assert!(
        invoke
            .invoke("request", json!({"data": "3e"}))
            .await
            .is_err()
    );

    runtime.close().await.expect("close diagnostic chain");
}

#[test]
fn loopback_backend_only_accepts_slcan() {
    let backend = LoopbackCanTransport {
        cancel: Arc::new(AtomicBool::new(false)),
    };
    assert!(backend.accepts(&TransportConfig::Slcan(SlcanConfig::default())));
    assert!(!backend.accepts(&TransportConfig::TestData(
        data_model::TestDataConfig::default()
    )));
    let _ = Error::Io(std::io::Error::other("unused"));
}

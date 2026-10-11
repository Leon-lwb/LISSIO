use acquisition::{AcquisitionRunState, AcquisitionRuntime, ExecutionGate, TransportBackend};
use data_model::TransportConfig;
use data_model::device::SimulationConfig;
use data_model::device_tree::NodeRole;
use data_model::device_tree::{NodeDecl, SIMULATION_DRIVER_ID};
use device_tree::{DeviceTreeAcquisition, DriverRegistry};
use std::sync::Arc;
use transport::device_driver::ByteDeviceDriver;

pub fn runtime(
    driver_id: &'static str,
    defaults: TransportConfig,
    backend: Arc<dyn TransportBackend>,
) -> AcquisitionRuntime {
    let registry = Arc::new(DriverRegistry::new());
    let execution = ExecutionGate::new(AcquisitionRunState::Stopped);
    registry
        .register(Arc::new(ByteDeviceDriver::new(
            driver_id,
            driver_id,
            defaults,
            backend,
            NodeRole::Bus,
            execution.clone(),
        )))
        .unwrap();
    AcquisitionRuntime::new(Arc::new(DeviceTreeAcquisition::with_execution(
        registry, execution,
    )))
}

pub fn node(
    id: &str,
    driver_id: &str,
    config: serde_json::Value,
    simulation: Option<SimulationConfig>,
) -> NodeDecl {
    let mut node = NodeDecl::leaf(id, id, driver_id, 1, config).unwrap();
    node.capability_endpoint_id = Some("device".into());
    if let Some(simulation) = simulation {
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

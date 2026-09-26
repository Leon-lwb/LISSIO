use acquisition::{CapabilitySet, PortDescriptor};
use async_trait::async_trait;
use data_model::ConfigurationSchema;
use device_tree::{
    CapabilityMask, ChildPolicy, CloseError, ConfigError, DriverId, NodeContext, NodeDecl,
    NodeDriver, NodeId, NodePath, NodeRole, NodeRuntime, NodeState, OpenError, ParentContract,
    RuntimeCapabilities, ValidatedNodeConfig,
};
use flow::PayloadKind;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

#[allow(dead_code)]
pub fn empty_schema() -> ConfigurationSchema {
    ConfigurationSchema {
        schema_version: 1,
        json_schema: json!({"type": "object", "additionalProperties": false}),
        ui_hints: json!({}),
    }
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct TestDriver {
    id: DriverId,
    role: NodeRole,
    declared: CapabilityMask,
    exposed: CapabilityMask,
    child_policy: ChildPolicy,
    ports: Vec<PortDescriptor>,
    required_parent_capabilities: Vec<device_tree::Capability>,
    required_parent_ports: Vec<&'static str>,
    fail_node_ids: BTreeSet<String>,
    fail_close: bool,
    log: Arc<Mutex<Vec<String>>>,
}

#[allow(dead_code)]
impl TestDriver {
    pub fn new(id: &str, role: NodeRole) -> Self {
        Self {
            id: DriverId::new(id),
            role,
            declared: CapabilityMask::empty(),
            exposed: CapabilityMask::empty(),
            child_policy: ChildPolicy::none(),
            ports: Vec::new(),
            required_parent_capabilities: Vec::new(),
            required_parent_ports: Vec::new(),
            fail_node_ids: BTreeSet::new(),
            fail_close: false,
            log: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub const fn capabilities(mut self, capabilities: CapabilityMask) -> Self {
        self.declared = capabilities;
        self.exposed = capabilities;
        self
    }

    pub const fn mismatched_capabilities(
        mut self,
        declared: CapabilityMask,
        exposed: CapabilityMask,
    ) -> Self {
        self.declared = declared;
        self.exposed = exposed;
        self
    }

    pub fn child_policy(mut self, policy: ChildPolicy) -> Self {
        self.child_policy = policy;
        self
    }

    pub fn ports(mut self, ports: Vec<PortDescriptor>) -> Self {
        self.ports = ports;
        self
    }

    pub fn require_parent(
        mut self,
        capabilities: &[device_tree::Capability],
        ports: &[&'static str],
    ) -> Self {
        self.required_parent_capabilities = capabilities.to_vec();
        self.required_parent_ports = ports.to_vec();
        self
    }

    pub const fn fail_close(mut self) -> Self {
        self.fail_close = true;
        self
    }

    pub fn fail_nodes(mut self, node_ids: &[&str]) -> Self {
        self.fail_node_ids = node_ids.iter().map(|id| (*id).to_string()).collect();
        self
    }

    pub fn log_handle(&self) -> Arc<Mutex<Vec<String>>> {
        self.log.clone()
    }

    pub fn log(&self) -> Vec<String> {
        self.log.lock().expect("test log lock").clone()
    }
}

#[async_trait]
impl NodeDriver for TestDriver {
    fn id(&self) -> DriverId {
        self.id.clone()
    }

    fn role(&self) -> NodeRole {
        self.role
    }

    fn capabilities(&self) -> CapabilityMask {
        self.declared
    }

    fn config_schema(&self) -> ConfigurationSchema {
        empty_schema()
    }

    fn child_policy(&self) -> ChildPolicy {
        self.child_policy.clone()
    }

    fn port_descriptors(&self, _config: &Value) -> Vec<PortDescriptor> {
        self.ports.clone()
    }

    fn validate(
        &self,
        config: &Value,
        parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        let test_node = NodeId::new("test-node").expect("valid test id");
        if !config.as_object().is_some_and(serde_json::Map::is_empty) {
            return Err(ConfigError::InvalidDriverConfig {
                node_id: test_node,
                detail: "测试驱动只接受空对象".into(),
            });
        }
        if let Some(parent) = parent {
            parent.require(&test_node, &self.required_parent_capabilities)?;
            parent.require_ports(&test_node, &self.required_parent_ports)?;
        } else {
            if let Some(capability) = self.required_parent_capabilities.first() {
                return Err(ConfigError::MissingParentCapability {
                    node_id: test_node,
                    capability: *capability,
                });
            }
            if let Some(port_id) = self.required_parent_ports.first() {
                return Err(ConfigError::MissingParentPort {
                    node_id: test_node,
                    port_id: (*port_id).to_string(),
                });
            }
        }
        Ok(ValidatedNodeConfig::new(self.id.clone(), 1, json!({})))
    }

    async fn open(
        &self,
        config: ValidatedNodeConfig,
        _parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        self.log
            .lock()
            .expect("test log lock")
            .push(format!("open:{}", context.node_id()));
        if self.fail_node_ids.contains(context.node_id().as_str()) {
            return Err(OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: config.driver_id().clone(),
                detail: "测试驱动配置为打开失败".into(),
            });
        }
        Ok(Arc::new(TestRuntime {
            node_id: context.node_id().clone(),
            node_path: context.node_path().clone(),
            driver: config.driver_id().clone(),
            exposed: self.exposed,
            ports: self.ports.clone(),
            state: parking_lot::RwLock::new(NodeState::Online {
                connection_epoch: context.connection_epoch(),
            }),
            close_count: parking_lot::Mutex::new(0),
            fail_close: self.fail_close,
            log: self.log.clone(),
        }))
    }
}

struct TestRuntime {
    node_id: NodeId,
    node_path: NodePath,
    driver: DriverId,
    exposed: CapabilityMask,
    ports: Vec<PortDescriptor>,
    state: parking_lot::RwLock<NodeState>,
    close_count: parking_lot::Mutex<usize>,
    fail_close: bool,
    log: Arc<Mutex<Vec<String>>>,
}

impl RuntimeCapabilities for TestRuntime {
    fn capability_projection(&self) -> CapabilityMask {
        self.exposed
    }
}

#[async_trait]
impl NodeRuntime for TestRuntime {
    fn node_id(&self) -> &NodeId {
        &self.node_id
    }

    fn path(&self) -> &NodePath {
        &self.node_path
    }

    fn driver(&self) -> &DriverId {
        &self.driver
    }

    fn state(&self) -> NodeState {
        self.state.read().clone()
    }

    fn port_descriptors(&self) -> &[PortDescriptor] {
        &self.ports
    }

    async fn close(&self) -> Result<(), CloseError> {
        *self.close_count.lock() += 1;
        self.log
            .lock()
            .expect("test log lock")
            .push(format!("close:{}", self.node_id));
        *self.state.write() = NodeState::Closed;
        if self.fail_close {
            return Err(CloseError {
                node_id: self.node_id.clone(),
                detail: "close failed".into(),
            });
        }
        Ok(())
    }
}

#[allow(dead_code)]
pub fn port(id: &str) -> PortDescriptor {
    PortDescriptor {
        id: id.into(),
        display_name: id.into(),
        direction: acquisition::PortDirection::Bidirectional,
        data_domain: PayloadKind::Bytes,
        operations: CapabilitySet::default(),
        address_space: None,
        data_types: BTreeSet::new(),
        display: None,
    }
}

#[allow(dead_code)]
pub fn node(id: &str, name: &str, driver: &str) -> NodeDecl {
    NodeDecl::leaf(id, name, driver, 1, json!({})).expect("valid test node")
}

#[allow(dead_code)]
pub const fn document(root: NodeDecl) -> device_tree::DeviceTreeDocument {
    device_tree::DeviceTreeDocument::new(root)
}

#[allow(dead_code)]
pub fn operation_counts(log: &[String]) -> BTreeMap<String, usize> {
    log.iter().fold(BTreeMap::new(), |mut output, entry| {
        *output.entry(entry.clone()).or_default() += 1;
        output
    })
}

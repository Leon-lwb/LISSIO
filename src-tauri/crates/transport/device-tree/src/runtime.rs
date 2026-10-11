//! 设备树子树打开、状态聚合和逆序关闭。

use crate::capability::ParentContract;
use crate::driver::{NodeContext, NodeDriver, NodeRuntime, NodeStateEvent};
use crate::error::{CloseError, ContractError, OpenError};
use crate::registry::DriverRegistry;
use data_model::device_tree::{
    DeviceTreeDocument, NodeDecl, NodeId, NodeIssue, NodePath, NodeRole, NodeSnapshot, NodeState,
};
use error::Error as _;
use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::sync::broadcast;

const STATE_EVENT_CAPACITY: usize = 1024;

/// 设备树打开入口。
pub struct DeviceTree {
    registry: Arc<DriverRegistry>,
    epochs: AtomicU64,
}

impl DeviceTree {
    /// 创建绑定驱动目录的设备树。
    pub const fn new(registry: Arc<DriverRegistry>) -> Self {
        Self {
            registry,
            epochs: AtomicU64::new(0),
        }
    }

    /// 校验并按父先子后顺序打开整棵树。
    pub async fn open(&self, document: DeviceTreeDocument) -> Result<DeviceTreeRuntime, OpenError> {
        self.registry.validate(&document)?;
        let (state_events, _) = broadcast::channel(STATE_EVENT_CAPACITY);
        let root_path = NodePath::root(&document.root.name).map_err(OpenError::from)?;
        let root = RuntimeNode::open(
            self.registry.clone(),
            document.root.clone(),
            root_path,
            None,
            None,
            self.epochs.fetch_add(1, Ordering::AcqRel).saturating_add(1),
            &state_events,
        )
        .await?;
        Ok(DeviceTreeRuntime {
            root,
            state_events,
            closed: AtomicBool::new(false),
        })
    }
}

/// 已打开设备树。关闭顺序为叶子到根，失败不会阻断其余节点释放。
pub struct DeviceTreeRuntime {
    root: RuntimeNode,
    state_events: broadcast::Sender<NodeStateEvent>,
    closed: AtomicBool,
}

impl DeviceTreeRuntime {
    /// 订阅节点状态事件。
    pub fn subscribe_states(&self) -> broadcast::Receiver<NodeStateEvent> {
        self.state_events.subscribe()
    }

    /// 按深度优先顺序返回节点状态。
    pub fn snapshots(&self) -> Vec<NodeSnapshot> {
        let mut output = Vec::new();
        self.root.collect_snapshots(&mut output);
        output
    }

    /// 查询节点运行时。
    pub fn runtime(&self, node_id: &NodeId) -> Option<Arc<dyn NodeRuntime>> {
        self.root
            .find(node_id)
            .and_then(|node| node.runtime.clone())
    }

    /// 查询节点路径。
    pub fn path(&self, node_id: &NodeId) -> Option<&NodePath> {
        self.root.find(node_id).map(|node| &node.path)
    }

    /// 逆序关闭全部子树。重复调用不重复执行底层 `close`。
    pub async fn close(&self) -> Result<(), Vec<CloseError>> {
        if self.closed.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let mut errors = Vec::new();
        self.root.close(&self.state_events, &mut errors).await;
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

struct RuntimeNode {
    declaration: NodeDecl,
    path: NodePath,
    driver: Arc<dyn NodeDriver>,
    runtime: Option<Arc<dyn NodeRuntime>>,
    children: Vec<Self>,
    required_children: BTreeSet<NodeId>,
    issue: Option<NodeIssue>,
    closed: AtomicBool,
}

impl RuntimeNode {
    #[allow(clippy::too_many_arguments)]
    async fn open(
        registry: Arc<DriverRegistry>,
        declaration: NodeDecl,
        path: NodePath,
        parent: Option<Arc<dyn NodeRuntime>>,
        parent_contract: Option<ParentContract>,
        connection_epoch: u64,
        state_events: &broadcast::Sender<NodeStateEvent>,
    ) -> Result<Self, OpenError> {
        if !declaration.enabled {
            return Ok(Self::disabled(declaration, path, registry));
        }
        let driver = registry.get(&declaration.driver).ok_or_else(|| {
            OpenError::Config(crate::error::ConfigError::UnknownDriver {
                node_id: declaration.id.clone(),
                driver_id: declaration.driver.clone(),
            })
        })?;
        let validated = driver
            .validate(&declaration.config, parent_contract.as_ref())
            .map_err(OpenError::from)?;
        let context = NodeContext::new(
            declaration.id.clone(),
            path.clone(),
            connection_epoch,
            state_events.clone(),
        )
        .with_simulation_assembly(declaration.children.iter().any(|child| {
            child.enabled && child.driver.as_str() == data_model::device_tree::SIMULATION_DRIVER_ID
        }));
        let runtime = driver.open(validated, parent, context).await?;
        if let Err(error) = validate_runtime_contract(
            &declaration,
            driver.as_ref(),
            runtime.as_ref(),
            parent_contract.as_ref(),
        ) {
            let _ = runtime.close().await;
            return Err(error.into());
        }
        let parent_online = matches!(runtime.state(), NodeState::Online { .. });
        let mut children = Vec::with_capacity(declaration.children.len());
        let policy = driver.child_policy();
        for child in &declaration.children {
            let child_path = path.child(&child.name).map_err(OpenError::from)?;
            let child_contract = ParentContract::from_runtime(driver.role(), runtime.as_ref());
            let opened = if parent_online {
                Box::pin(Self::open(
                    registry.clone(),
                    child.clone(),
                    child_path.clone(),
                    Some(runtime.clone()),
                    Some(child_contract),
                    connection_epoch,
                    state_events,
                ))
                .await
            } else {
                Err(OpenError::ParentNotOnline {
                    node_id: child.id.clone(),
                    state: runtime.state(),
                })
            };
            children.push(opened.unwrap_or_else(|error| {
                Self::failed(
                    child.clone(),
                    child_path,
                    registry.clone(),
                    NodeIssue {
                        error_kind: error.kind().to_string(),
                        detail: error.to_string(),
                    },
                )
            }));
        }
        let required_children = children
            .iter()
            .zip(declaration.children.iter())
            .filter_map(|(child, declaration)| {
                child_role(&registry, declaration).map(|role| (role, child))
            })
            .filter(|(role, _)| policy.is_required(*role))
            .map(|(_, child)| child.declaration.id.clone())
            .collect();
        Ok(Self {
            declaration,
            path,
            driver,
            runtime: Some(runtime),
            children,
            required_children,
            issue: None,
            closed: AtomicBool::new(false),
        })
    }

    fn disabled(declaration: NodeDecl, path: NodePath, registry: Arc<DriverRegistry>) -> Self {
        Self::inactive(declaration, path, registry, None)
    }

    fn failed(
        declaration: NodeDecl,
        path: NodePath,
        registry: Arc<DriverRegistry>,
        issue: NodeIssue,
    ) -> Self {
        Self::inactive(declaration, path, registry, Some(issue))
    }

    /// 未打开的子树仍保留完整拓扑，供状态查询和路径寻址。
    fn inactive(
        declaration: NodeDecl,
        path: NodePath,
        registry: Arc<DriverRegistry>,
        issue: Option<NodeIssue>,
    ) -> Self {
        let driver = registry
            .get(&declaration.driver)
            .expect("document validation resolved node driver");
        let issue = declaration.enabled.then_some(issue).flatten();
        let children = declaration
            .children
            .iter()
            .map(|child| {
                let child_path = path.child(&child.name).expect("validated child path");
                Self::inactive(child.clone(), child_path, registry.clone(), issue.clone())
            })
            .collect();
        Self {
            declaration,
            path,
            driver,
            runtime: None,
            children,
            required_children: BTreeSet::new(),
            issue,
            closed: AtomicBool::new(false),
        }
    }

    fn state(&self) -> NodeState {
        if self.closed.load(Ordering::Acquire) {
            return NodeState::Closed;
        }
        if !self.declaration.enabled {
            return NodeState::Disabled;
        }
        let Some(runtime) = &self.runtime else {
            return self
                .issue
                .as_ref()
                .map_or(NodeState::Disabled, |issue| NodeState::Degraded {
                    detail: issue.detail.clone(),
                });
        };
        let own = runtime.state();
        if !matches!(own, NodeState::Online { .. }) {
            return own;
        }
        let required_degraded = self.children.iter().any(|child| {
            self.required_children.contains(&child.declaration.id)
                && !matches!(
                    child.state(),
                    NodeState::Online { .. } | NodeState::Disabled
                )
        });
        if required_degraded {
            NodeState::Degraded {
                detail: "必需子节点不可用".into(),
            }
        } else {
            own
        }
    }

    fn snapshot(&self) -> NodeSnapshot {
        NodeSnapshot {
            node_id: self.declaration.id.clone(),
            node_path: self.path.clone(),
            driver: self.declaration.driver.clone(),
            enabled: self.declaration.enabled,
            state: self.state(),
            capabilities: self.runtime.as_ref().map_or_else(
                || self.driver.capabilities(),
                |runtime| runtime.capability_projection(),
            ),
            issue: self.issue.clone(),
        }
    }

    fn collect_snapshots(&self, output: &mut Vec<NodeSnapshot>) {
        output.push(self.snapshot());
        for child in &self.children {
            child.collect_snapshots(output);
        }
    }

    fn find(&self, node_id: &NodeId) -> Option<&Self> {
        if self.declaration.id == *node_id {
            return Some(self);
        }
        self.children.iter().find_map(|child| child.find(node_id))
    }

    async fn close(
        &self,
        state_events: &broadcast::Sender<NodeStateEvent>,
        errors: &mut Vec<CloseError>,
    ) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        for child in self.children.iter().rev() {
            Box::pin(child.close(state_events, errors)).await;
        }
        let mut close_error = None;
        if let Some(runtime) = &self.runtime {
            let _ = state_events.send(NodeStateEvent {
                node_id: self.declaration.id.clone(),
                node_path: self.path.clone(),
                state: NodeState::Closing,
                connection_epoch: runtime.state().connection_epoch().unwrap_or_default(),
                error_kind: None,
                detail: None,
            });
            if let Err(error) = runtime.close().await {
                close_error = Some((error.kind().to_string(), error.to_string()));
                errors.push(error);
            }
        }
        let _ = state_events.send(NodeStateEvent {
            node_id: self.declaration.id.clone(),
            node_path: self.path.clone(),
            state: NodeState::Closed,
            connection_epoch: 0,
            error_kind: close_error.as_ref().map(|(kind, _)| kind.clone()),
            detail: close_error.map(|(_, detail)| detail),
        });
    }
}

fn child_role(registry: &DriverRegistry, declaration: &NodeDecl) -> Option<NodeRole> {
    registry
        .get(&declaration.driver)
        .map(|driver| driver.role())
}

fn validate_runtime_contract(
    declaration: &NodeDecl,
    driver: &dyn NodeDriver,
    runtime: &dyn NodeRuntime,
    parent_contract: Option<&ParentContract>,
) -> Result<(), ContractError> {
    if runtime.driver() != &declaration.driver {
        return Err(ContractError::RuntimeDriverMismatch {
            node_id: declaration.id.clone(),
            expected_driver: declaration.driver.clone(),
            runtime_driver: runtime.driver().clone(),
        });
    }
    let mismatches = crate::capability::contract_mismatches(
        driver.runtime_capabilities(&declaration.config, parent_contract),
        &declaration.id,
        runtime,
    );
    mismatches.into_iter().next().map_or(Ok(()), Err)
}

//! 节点运行时 typed port 和能力投影契约。

use crate::driver::{NodeContext, NodeRuntime};
use crate::error::{ContractError, OpenError, PortError};
use acquisition::{AddressSpaceDescriptor, DiscoveredEndpoint, PortDescriptor};
use async_trait::async_trait;
use can::CanFrame;
use data_model::device::SimulationConfig;
use flow::{BytesChunk, FlowEnvelope};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::broadcast;

pub use data_model::device_tree::{ALL_CAPABILITIES, Capability, CapabilityMask};
use data_model::device_tree::{NodeId, NodeRole};

/// 检查能力声明与运行时投影的逐项闭环。
pub fn contract_mismatches(
    declared: CapabilityMask,
    node_id: &NodeId,
    runtime: &dyn RuntimeCapabilities,
) -> Vec<ContractError> {
    let exposed = runtime.capability_projection();
    ALL_CAPABILITIES
        .iter()
        .copied()
        .filter(|capability| declared.has(*capability) != exposed.has(*capability))
        .map(|capability| ContractError::CapabilityMismatch {
            node_id: node_id.clone(),
            capability,
            declared: declared.has(capability),
            exposed: exposed.has(capability),
        })
        .collect()
}

/// 运行时能力投影的只读查询，供合同检查和父节点契约派生使用。
pub trait RuntimeCapabilities: Send + Sync {
    fn capability_projection(&self) -> CapabilityMask;
}

/// 父节点向子节点暴露的最小静态契约。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParentContract {
    pub role: NodeRole,
    pub capabilities: CapabilityMask,
    pub port_descriptors: Vec<PortDescriptor>,
}

impl ParentContract {
    /// 从父驱动角色和运行时投影派生契约。
    pub fn from_runtime(
        role: NodeRole,
        runtime: &(dyn crate::driver::NodeRuntime + 'static),
    ) -> Self {
        Self {
            role,
            capabilities: runtime.capability_projection(),
            port_descriptors: runtime.port_descriptors().to_vec(),
        }
    }

    /// 父节点是否提供能力。
    pub const fn provides(&self, capability: Capability) -> bool {
        self.capabilities.has(capability)
    }

    /// 父节点是否提供稳定端口 id。
    pub fn provides_port(&self, port_id: &str) -> bool {
        self.port_descriptors.iter().any(|port| port.id == port_id)
    }

    /// 校验子节点要求的父能力。
    pub fn require(
        &self,
        node_id: &NodeId,
        capabilities: &[Capability],
    ) -> Result<(), crate::error::ConfigError> {
        for capability in capabilities {
            if !self.provides(*capability) {
                return Err(crate::error::ConfigError::MissingParentCapability {
                    node_id: node_id.clone(),
                    capability: *capability,
                });
            }
        }
        Ok(())
    }

    /// 校验子节点要求的父端口。
    pub fn require_ports(
        &self,
        node_id: &NodeId,
        ports: &[&str],
    ) -> Result<(), crate::error::ConfigError> {
        for port_id in ports {
            if !self.provides_port(port_id) {
                return Err(crate::error::ConfigError::MissingParentPort {
                    node_id: node_id.clone(),
                    port_id: (*port_id).to_string(),
                });
            }
        }
        Ok(())
    }
}

/// 多消费者 typed frame 订阅。丢失单位由 `T` 的生产者契约决定。
pub struct FrameSubscription<T: Clone + Send + Sync> {
    receiver: broadcast::Receiver<T>,
}

impl<T: Clone + Send + Sync> FrameSubscription<T> {
    /// 从广播接收端创建 typed 订阅。
    pub const fn from_receiver(receiver: broadcast::Receiver<T>) -> Self {
        Self { receiver }
    }

    /// 接收下一条 typed payload。
    pub async fn recv(&mut self) -> Result<T, broadcast::error::RecvError> {
        self.receiver.recv().await
    }

    /// 非阻塞接收下一条 typed payload。
    pub fn try_recv(&mut self) -> Result<T, broadcast::error::TryRecvError> {
        self.receiver.try_recv()
    }

    /// 当前排队消息数。
    pub fn len(&self) -> usize {
        self.receiver.len()
    }

    /// 当前是否无排队消息。
    pub fn is_empty(&self) -> bool {
        self.receiver.is_empty()
    }

    /// 取回底层广播接收端。
    pub fn into_receiver(self) -> broadcast::Receiver<T> {
        self.receiver
    }
}

/// 字节流 typed source。
#[async_trait]
pub trait ByteSourceCapability: RuntimeCapabilities {
    fn subscribe_bytes(&self) -> FrameSubscription<FlowEnvelope<BytesChunk>>;
}

/// 字节流 typed sink。
#[async_trait]
pub trait ByteSinkCapability: RuntimeCapabilities {
    async fn send_bytes(&self, envelope: &FlowEnvelope<BytesChunk>) -> Result<(), PortError>;

    fn try_send_bytes(&self, envelope: &FlowEnvelope<BytesChunk>) -> Result<(), PortError>;
}

/// CAN 帧父子节点稳定端口 id。
pub const CAN_FRAMES_PORT_ID: &str = "can.frames";

/// ISO-TP 请求/响应父子节点稳定端口 id。
pub const ISOTP_REQUEST_PORT_ID: &str = "isotp.request-response";

/// CAN 帧 typed source。
#[async_trait]
pub trait CanFrameSourceCapability: RuntimeCapabilities {
    fn subscribe_frames(&self) -> FrameSubscription<CanFrame>;
}

/// CAN 帧 typed sink。
#[async_trait]
pub trait CanFrameSinkCapability: RuntimeCapabilities {
    async fn send_frame(&self, frame: &CanFrame) -> Result<(), PortError>;
}

/// ISO-TP 请求/响应 typed port。
///
/// 该端口用于 `ISO-TP -> Diagnostic` 父子装配，不进入通用 [`CapabilityMask`]。
#[async_trait]
pub trait IsoTpRequestCapability: RuntimeCapabilities {
    async fn request(&self, data: Vec<u8>) -> Result<Vec<u8>, PortError>;
}

/// UDS、设备方法和 OPC UA 方法的统一调用入口。
#[async_trait]
pub trait InvokeCapability: RuntimeCapabilities {
    async fn invoke(&self, method: &str, args: Value) -> acquisition::AcquisitionResult<Value>;
}

/// 地址空间浏览能力。
#[async_trait]
pub trait BrowseCapability: RuntimeCapabilities {
    async fn browse(&self) -> acquisition::AcquisitionResult<Vec<AddressSpaceDescriptor>>;
}

/// 设备发现能力。
#[async_trait]
pub trait DiscoverCapability: RuntimeCapabilities {
    async fn discover(&self) -> acquisition::AcquisitionResult<Vec<DiscoveredEndpoint>>;
}

/// 父节点向仿真子节点提供隔离的虚拟来源会话。
///
/// 这是设备树内部的装配端口，不进入 `CapabilityMask`；仿真节点的普通数据能力
/// 由打开后的 [`NodeRuntime`] 投影。
#[async_trait]
pub trait SimulationProviderCapability: RuntimeCapabilities {
    async fn open_simulation(
        &self,
        config: SimulationConfig,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError>;
}

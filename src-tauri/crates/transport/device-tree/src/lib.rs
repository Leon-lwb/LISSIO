//! 设备拓扑、节点行为契约、typed port 能力投影和子树生命周期。
//!
//! 拓扑是设备事实的单一来源：[`NodeDecl`] 描述装配，[`NodeDriver`] 描述行为，
//! [`NodeRuntime`] 描述当前能力，[`DeviceTreeRuntime`] 按子树传播生命周期。
//! 硬件和 SDK 适配器留在 L4 crate，由组合根注入本 crate 的驱动注册表。

mod builtin;
mod capability;
mod driver;
mod error;
mod production;
mod protocol_engine;
mod registry;
mod runtime;
mod simulation;
mod source_runtime;
mod source_support;

pub use builtin::{ROOT_DRIVER_ID, RootDriver, check_runtime_contract, parent_fixture};
pub use capability::{
    ALL_CAPABILITIES, BrowseCapability, ByteSinkCapability, ByteSourceCapability,
    CAN_FRAMES_PORT_ID, CanFrameSinkCapability, CanFrameSourceCapability, Capability,
    CapabilityMask, DiscoverCapability, FrameSubscription, ISOTP_REQUEST_PORT_ID, InvokeCapability,
    IsoTpRequestCapability, ParentContract, RuntimeCapabilities,
};
pub use driver::{
    DriverContractFixture, NodeContext, NodeDriver, NodeRuntime, NodeStateEvent, ParentFixture,
    ValidatedNodeConfig, runtime_capability_mask,
};
pub use error::{CloseError, ConfigError, ContractError, OpenError, PortError};
pub use production::DeviceTreeAcquisition;
pub use protocol_engine::{PROTOCOL_ENGINE_DRIVER_ID, ProtocolEngineDriver};
pub use registry::{DriverProjection, DriverRegistry};
pub use runtime::{DeviceTree, DeviceTreeRuntime};
pub use simulation::SimulationDriver;
pub use source_support::{
    SourceRuntimeBuilder, SourceValidationState, source_capability_mask, source_child_policy,
    source_payload,
};

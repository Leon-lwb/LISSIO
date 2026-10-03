//! Build-time TypeScript contract export.
//!
//! Explicit export program (no test-time auto-write, no BackendHost, no
//! hardware, no user configuration, no network): references wire types at
//! their owning crates and writes one `.ts` file per type into the directory
//! given by `TS_RS_EXPORT_DIR`.
//!
//! Run via `pnpm generate:contracts` (scripts/generate-contracts.mjs), which
//! sets:
//! - `TS_RS_EXPORT_DIR` — output directory (`src/types/generated`)
//! - `TS_RS_LARGE_INT=number` — i64/u64 wire JSON numbers stay `number`
//!
//! Output must be deterministic; `pnpm check:contracts` re-runs this into a
//! temp directory and diffs against the committed files.

use ts_rs::{Config, TS};

/// Export one type; missing exports surface as a dangling import in the
/// frontend typecheck, so the list below must stay a superset of every
/// referenced dependency.
macro_rules! export {
    ($cfg:expr, $($t:ty),+ $(,)?) => {{
        let mut failures: Vec<String> = Vec::new();
        $(
            if let Err(err) = <$t as TS>::export($cfg) {
                failures.push(format!("{}: {err}", stringify!($t)));
            }
        )+
        failures
    }};
}

fn main() {
    let cfg = Config::from_env();
    let out_dir = std::env::var("TS_RS_EXPORT_DIR").unwrap_or_else(|_| "./bindings".into());
    println!("exporting TypeScript contracts to {out_dir}");

    let failures = export! { &cfg,
        // ---- 共享 schema 容器与 JSON 值 ----
        serde_json::Value,

        // ---- 模型目录合同 (data-model::model_descriptor) ----
        data_model::model_descriptor::ModelCatalog,
        data_model::model_descriptor::ModelDescriptor,
        data_model::model_descriptor::ModelFamily,
        data_model::model_descriptor::ModelDisplay,
        data_model::model_descriptor::ModelUiHints,
        data_model::model_descriptor::ModelVariant,
        data_model::model_descriptor::ModelAction,
        data_model::model_descriptor::ModelAvailability,
        data_model::model_descriptor::ModelAvailabilityState,
        data_model::model_descriptor::ModelIssue,
        data_model::model_descriptor::IssueSeverity,
        data_model::model_descriptor::ConfigurationSchema,
        data_model::model_descriptor::NodePortDomain,
        data_model::model_descriptor::NodePortDescriptor,

        // ---- 后端性能监视合同 (performance) ----
        performance::BackendPerformanceSnapshot,
        performance::ProcessPerformance,
        performance::RpcPerformance,
        performance::WebSocketPerformance,
        performance::PipelinePerformance,

        // ---- 数据面板合同 (data-model::panel_descriptor) ----
        data_model::panel_descriptor::PanelDescriptor,
        data_model::panel_descriptor::PanelKind,
        data_model::panel_descriptor::PanelDelivery,
        data_model::panel_descriptor::PanelDataPlane,
        data_model::panel_descriptor::PanelBinding,

        // ---- 设备树声明 (data-model::device_tree) ----
        data_model::device_tree::NodeId,
        data_model::device_tree::NodePath,
        data_model::device_tree::DriverId,
        data_model::device_tree::NodeRole,
        data_model::device_tree::ChildLimit,
        data_model::device_tree::ChildPolicy,
        data_model::device_tree::NodeDecl,
        data_model::device_tree::DeviceTreeDocument,
        data_model::device_tree::Capability,
        data_model::device_tree::CapabilityMask,
        data_model::device_tree::NodeState,
        data_model::device_tree::NodeIssue,
        data_model::device_tree::NodeSnapshot,

        // ---- 设备/仿真/传输配置 (data-model) ----
        data_model::device::DriverPayload,
        data_model::device::DevicePort,
        data_model::device::DevicePortDirection,
        data_model::device::DevicePortDomain,
        data_model::device::SimulationConfig,
        data_model::device::SignalParameters,
        data_model::device::TestWaveform,
        data_model::TransportConfig,
        data_model::SerialConfig,
        data_model::UdpConfig,
        data_model::TcpClientConfig,
        data_model::TcpServerConfig,
        data_model::TestDataConfig,
        data_model::SlcanConfig,
        data_model::CandleConfig,
        data_model::TestSignal,
        data_model::Parity,
        data_model::StopBits,
        data_model::FlowControl,
        data_model::CanBitrate,
        data_model::PortInfo,
        data_model::ConnectionState,
        data_model::TransportStats,

        // ---- flow 数据面词表 ----
        flow::SourceId,
        flow::PayloadKind,
        flow::Direction,
        flow::LostUnit,
        flow::FlowGap,

        // ---- 能力投影 (acquisition::capabilities) ----
        acquisition::AdapterCapability,
        acquisition::AddressRegion,
        acquisition::AddressSpaceDescriptor,
        acquisition::DisplaySemantics,
        acquisition::EndpointDescriptor,
        acquisition::EndpointDirection,
        acquisition::PortDescriptor,
        acquisition::PortDirection,
        acquisition::ProtocolKind,
        acquisition::RuntimeState,
        acquisition::RuntimeStatus,
        acquisition::TransportKind,
        acquisition::DiscoveredEndpoint,
        acquisition::DriverManifest,
        acquisition::DriverSchema,
        acquisition::CapabilitySet,
        acquisition::SessionCapabilities,
        acquisition::SubscriptionIntent,
        acquisition::PointRejection,
        acquisition::EffectiveSubscription,
        device_tree::DriverProjection,

        // ---- 点位冷路径 (points) ----
        points::PointId,
        points::StructField,
        points::PointValue,
        points::Validity,
        points::NativeStatus,
        points::PointQuality,
        points::PointDataType,
        points::AccessLevel,
        points::NativeAddress,
        points::PointDescriptor,
        points::AcquisitionMode,
        points::Priority,
        points::DeliveryClass,
        points::AcquisitionIntent,

        // ---- 逻辑解码 / 诊断 (协议配置引用) ----
        logic::LogicDecoderConfig,
        logic::LogicSample,
        logic::I2cEvent,
        logic::DecodedEvent,
        diagnostic::DiagnosticConfig,
        diagnostic::IsoTpAddressMode,
        diagnostic::IsoTpConfig,
        diagnostic::UdsConfig,
        diagnostic::ObdConfig,
        diagnostic::J1939Config,

        // ---- 协议 schema (schema_types) ----
        schema_types::ChecksumAlgorithm,
        schema_types::FieldType,
        schema_types::DecoderBlockDef,
        schema_types::DecoderChecksumCover,
        schema_types::DecoderChecksumPosition,
        schema_types::LengthUnit,
        schema_types::AsciiBase,
        schema_types::EncodeBlockDef,
        schema_types::ProtocolConfig,
        schema_types::ProtocolNodeConfig,
        schema_types::ProtocolSchema,
        schema_types::SchemaPreset,

        // ---- 图文档与节点定义 (kind) ----
        kind::document::NodeDocument,
        kind::document::NodeBusiness,
        kind::document::NodeLayout,
        kind::document::CustomPorts,
        kind::NodeDef,
        kind::NodeOrigin,
        kind::NodeKind,
        kind::NewlineMode,
        kind::MathOp,
        kind::StrOp,
        kind::StrNumParams,
        // ---- 控件参数结构 (kind::widgets) ----
        kind::widgets::InputBinding,
        kind::widgets::BindingMode,
        kind::widgets::BindingParams,
        kind::widgets::ChoiceOption,
        kind::widgets::DisplayPrecision,
        kind::widgets::DisplayRange,
        kind::widgets::DisplayRangeMode,
        kind::widgets::KnobParams,
        kind::widgets::SliderParams,
        kind::widgets::ButtonParams,
        kind::widgets::RadioParams,
        kind::widgets::CheckboxParams,
        kind::widgets::LabelParams,
        kind::widgets::GaugeParams,
        kind::widgets::ProgressParams,
        kind::widgets::ProgressOrientation,
        kind::widgets::LedParams,
        kind::widgets::NumberDisplayParams,
        kind::widgets::PieChartParams,
        kind::widgets::ImageParams,
        kind::widgets::ImageFormat,
        kind::widgets::WaveformParams,
        kind::widgets::SpectrumParams,
        kind::widgets::Model3DParams,
        kind::widgets::Model3DMode,
        kind::widgets::Model3DAttitudeInputMode,
        kind::widgets::Model3DSource,
        kind::widgets::Model3DSourceKind,
        kind::widgets::TableViewColumn,
        kind::widgets::TableViewParams,
        kind::widgets::RawDataParams,
        kind::widgets::CommandParams,
        kind::widgets::CommandFrame,
        kind::widgets::CommandBlock,
        kind::widgets::CommandBlockType,
        kind::widgets::CommandSendMode,
        kind::widgets::FrameDecoderParams,
        kind::widgets::TriggerParams,
        kind::widgets::TriggerRule,
        kind::widgets::TriggerMatchType,
        kind::widgets::TriggerOutputType,
        kind::widgets::TriggerEdge,
        // ---- 模型目录/准备/描述 RPC 合同 (rpc-api::models + app::models) ----
        rpc_api::models::PrepareRequest,
        rpc_api::models::PrepareOperationDto,
        rpc_api::models::PrepareResponse,
        rpc_api::models::PrepareOutcome,
        rpc_api::models::DescribeResponse,
        app::models::NodeDescription,
        app::models::NodeDescriptionStatus,
        app::models::NodeHint,
        app::models::DescribeRequest,
        app::models::DescribeResult,
        app::models::GraphEdgeRef,
        filter::FilterConfig,
        spectrum::WindowType,
        spectrum::SpectrumOutput,
        trigger::TriggerRuleDef,
        trigger::TriggerMatchType,
    };

    if failures.is_empty() {
        println!("contract export finished");
    } else {
        for failure in &failures {
            eprintln!("export failed: {failure}");
        }
        std::process::exit(1);
    }
}

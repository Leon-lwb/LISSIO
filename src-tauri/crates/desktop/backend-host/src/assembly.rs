//! 采集适配器装配与点位投影观察者 — 无界面版本。
//!
//! 层级: L5 (desktop 域) 的后端装配内核。Tauri 组合根与无界面 CLI 都调用这里,
//! 保证两端注册的适配器与点位投影完全一致 (装配不重复)。

use std::sync::Arc;

use acquisition::PointBatchObserver;
use pipeline::{SourceGraphs, data_plane::DataPlaneState, point_projection::PointProjection};
use points::PointEnvelope;

/// 点位批次观察者 — 把采集端点推送的点位样本投影进数据平面四域。
///
/// clippy 误报: 私有根模块内的 pub(crate) 对 crate:: 路径访问是必需的。
#[allow(clippy::redundant_pub_crate)]
pub(crate) struct FourDomainPointObserver(PointProjection);

impl FourDomainPointObserver {
    #[allow(clippy::redundant_pub_crate)]
    pub(crate) fn new(plane: &DataPlaneState, graphs: SourceGraphs) -> Self {
        Self(PointProjection::new(plane, graphs))
    }
}

impl PointBatchObserver for FourDomainPointObserver {
    fn observe(&self, envelope: &PointEnvelope) {
        self.0.accept(envelope);
    }
}

/// 装配全部传输/采集适配器 — 字节设备工厂 + 可选工业协议适配器。
///
/// `modbus-tcp` / `modbus-rtu` / `s7` feature 控制后三类适配器是否注册。
pub fn build_acquisition_runtime() -> (
    acquisition::AcquisitionRuntime,
    Arc<device_tree::DriverRegistry>,
) {
    use acquisition::{AcquisitionRunState, ExecutionGate, TransportBackend};
    use data_model::{
        CandleConfig, SerialConfig, SlcanConfig, TcpClientConfig, TcpServerConfig, TransportConfig,
        UdpConfig,
    };
    use transport::device_driver::ByteDeviceDriver;
    use transport::test_data::TestDataBackend;

    let execution = ExecutionGate::new(AcquisitionRunState::Stopped);
    let registry = Arc::new(device_tree::DriverRegistry::new());
    let serial = Arc::new(serial::SerialBackend) as Arc<dyn TransportBackend>;
    let network = Arc::new(network::NetworkBackend) as Arc<dyn TransportBackend>;
    let can = Arc::new(can_transport::CanTransportBackend) as Arc<dyn TransportBackend>;
    for (id, label, config, backend) in [
        (
            "serial",
            "Serial",
            TransportConfig::Serial(SerialConfig::default()),
            serial,
        ),
        (
            "tcp-client",
            "TCP Client",
            TransportConfig::TcpClient(TcpClientConfig::default()),
            network.clone(),
        ),
        (
            "tcp-server",
            "TCP Server",
            TransportConfig::TcpServer(TcpServerConfig::default()),
            network.clone(),
        ),
        (
            "udp",
            "UDP",
            TransportConfig::Udp(UdpConfig::default()),
            network,
        ),
        (
            "slcan",
            "Slcan",
            TransportConfig::Slcan(SlcanConfig::default()),
            can.clone(),
        ),
        (
            "candle-light",
            "CandleLight",
            TransportConfig::CandleLight(CandleConfig::default()),
            can,
        ),
    ] {
        registry
            .register(Arc::new(ByteDeviceDriver::new(
                id,
                label,
                config,
                backend,
                data_model::device_tree::NodeRole::Bus,
                execution.clone(),
            )))
            .expect("fresh device-tree registry accepts byte drivers");
    }
    registry
        .register(Arc::new(automotive::CanChannelDriver::new()))
        .expect("fresh device-tree registry accepts CAN channel");
    registry
        .register(Arc::new(automotive_isotp::IsoTpNodeDriver::new()))
        .expect("fresh device-tree registry accepts ISO-TP");
    registry
        .register(Arc::new(automotive_diag::DiagnosticNodeDriver::new()))
        .expect("fresh device-tree registry accepts diagnostics");
    registry
        .register(Arc::new(ByteDeviceDriver::new(
            "test-data",
            "Test Data",
            TransportConfig::TestData(data_model::TestDataConfig::default()),
            Arc::new(TestDataBackend),
            data_model::device_tree::NodeRole::Virtual,
            execution.clone(),
        )))
        .expect("fresh device-tree registry accepts test data");
    #[cfg(feature = "modbus-tcp")]
    registry
        .register(Arc::new(modbus_adapter::ModbusTcpDriver::new(
            execution.clone(),
        )))
        .expect("fresh device-tree registry accepts Modbus TCP");
    #[cfg(feature = "modbus-rtu")]
    registry
        .register(Arc::new(modbus_adapter::ModbusRtuDriver::new(
            execution.clone(),
        )))
        .expect("fresh device-tree registry accepts Modbus RTU");
    #[cfg(feature = "s7")]
    registry
        .register(Arc::new(s7_adapter::S7Driver::new(execution.clone())))
        .expect("fresh device-tree registry accepts S7");
    let runtime = acquisition::AcquisitionRuntime::new(Arc::new(
        device_tree::DeviceTreeAcquisition::with_execution(registry.clone(), execution),
    ));
    (runtime, registry)
}

/// 组装模型目录 — 从设备树注册表与 L4 provider 注册表投影 (WP5 统一 RPC)。
pub fn build_model_catalog(
    drivers: &Arc<device_tree::DriverRegistry>,
) -> app::models::ModelCatalogSnapshot {
    use app::models::{CatalogSources, ModelDescriptor, ModelDisplay, ModelFamily, ModelUiHints};

    let providers: Vec<ModelDescriptor> = llm::types::list_adapters()
        .iter()
        .map(|adapter| ModelDescriptor {
            id: format!("aiProvider:{}", adapter.id),
            family: ModelFamily::AiProvider,
            schema_version: 1,
            display: ModelDisplay::fallback(adapter.label),
            ui: ModelUiHints::default(),
            configuration: data_model::model_descriptor::ConfigurationSchema {
                schema_version: 1,
                json_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "baseUrl": { "type": "string" },
                        "apiKey": { "type": "string", "writeOnly": true },
                        "model": { "type": "string" },
                        "temperature": { "type": "number" },
                        "maxTokens": { "type": "integer", "minimum": 1 },
                    },
                }),
                ui_hints: serde_json::json!({
                    "requiresCustomUrl": adapter.requires_custom_url,
                    "requiresApiKey": adapter.requires_api_key,
                    "defaultBaseUrl": adapter.default_base_url,
                }),
            },
            // 目录不携带密钥 — 密钥来源仍是系统凭据库
            default_config: serde_json::json!({
                "adapter": adapter.id,
                "baseUrl": adapter.default_base_url,
                "requiresApiKey": adapter.requires_api_key,
            }),
            variants: Vec::new(),
            actions: vec![data_model::model_descriptor::ModelAction::Configure],
            availability: data_model::model_descriptor::ModelAvailability::AVAILABLE,
        })
        .collect();
    app::models::build_model_catalog(CatalogSources {
        drivers,
        ai_providers: &providers,
    })
    .expect("model catalog assembles from registered drivers")
}

/// 把四域点位投影观察者挂到采集运行时 (与打开端点配对)。
pub fn install_point_observer(state: &app::AppState) {
    state
        .transport
        .set_observer(Arc::new(FourDomainPointObserver::new(
            &state.data_plane,
            state.source_graphs.clone(),
        )));
}

/// 注入包络计算引擎 — GPU 加速 + CPU 回退 (`gpu` crate 的 L4 实现)。
pub fn install_envelope_engine(state: &app::AppState) {
    state.set_envelope_engine(Arc::new(gpu::AdaptiveEnvelopeEngine));
}

/// 注入串口发现服务 — `serial` crate 的 L4 平台枚举实现。
pub fn install_serial_discovery(state: &app::AppState) {
    state.set_serial_discovery(Arc::new(PlatformSerialDiscovery));
}

/// [`app::SerialDiscovery`] 的平台实现 — 委托 `serial` crate 枚举管线。
struct PlatformSerialDiscovery;

impl app::SerialDiscovery for PlatformSerialDiscovery {
    fn list_ports(&self) -> Result<Vec<data_model::PortInfo>, String> {
        serial::serial::list_ports().map_err(|error| error.to_string())
    }
}

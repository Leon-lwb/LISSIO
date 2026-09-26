//! Byte adapters participate in the same capability directory and sessions as Modbus.
use acquisition::handle::TransportHandle;
use acquisition::{
    AcquisitionError, AcquisitionResult, AdapterCapability, CAPABILITY_CONTRACT_VERSION,
    CapabilitySet, DriverManifest, DriverSchema, EndpointDescriptor, EndpointDirection,
    PortDescriptor, PortDirection, ProtocolKind, RuntimeState, RuntimeStatus, SessionCapabilities,
    SourceFactory, SourceSession, TransportBackend, TransportKind, ValidatedConfig,
};
use async_trait::async_trait;
use data_model::CanBitrate;
use data_model::ConfigurationSchema;
use data_model::TransportConfig;
use data_model::device::{DriverId, DriverPayload};
use flow::PayloadKind;
use schema_types::{ProtocolConfig, TestDataLink};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::Arc;

pub struct ByteDeviceFactory {
    manifest: DriverManifest,
    defaults: TransportConfig,
    backend: Arc<dyn TransportBackend>,
}

impl ByteDeviceFactory {
    /// 驱动的默认传输配置 (装配时以 TransportConfig::default 传入)。
    pub const fn defaults(&self) -> &TransportConfig {
        &self.defaults
    }

    pub fn new(
        id: &str,
        name: &str,
        defaults: TransportConfig,
        backend: Arc<dyn TransportBackend>,
    ) -> Self {
        Self {
            manifest: DriverManifest {
                id: DriverId(id.into()),
                display_name: name.into(),
                payload_kinds: BTreeSet::from([PayloadKind::Bytes]),
                capabilities: CapabilitySet {
                    byte_source: true,
                    byte_sink: true,
                    discover: backend.supports_discovery(),
                    ..CapabilitySet::default()
                },
            },
            defaults,
            backend,
        }
    }

    fn config(&self, payload: &DriverPayload) -> AcquisitionResult<TransportConfig> {
        if payload.driver_id != self.manifest.id || payload.schema_version != 1 {
            return Err(AcquisitionError::InvalidConfig(
                "driver or schema version mismatch".into(),
            ));
        }
        let mut value = serde_json::to_value(&self.defaults)
            .map_err(|e| AcquisitionError::InvalidConfig(e.to_string()))?;
        value["params"] = payload.payload.clone();
        serde_json::from_value(value).map_err(|e| AcquisitionError::InvalidConfig(e.to_string()))
    }
}

#[async_trait]
impl SourceFactory for ByteDeviceFactory {
    async fn simulate(
        &self,
        _input: &DriverPayload,
        config: &data_model::device::SimulationConfig,
        context: acquisition::DriverContext,
    ) -> AcquisitionResult<Box<dyn SourceSession>> {
        crate::byte_simulation::open(config.clone(), context)
    }
    fn discover(&self) -> AcquisitionResult<Vec<acquisition::DiscoveredEndpoint>> {
        self.backend
            .discover(&self.defaults)
            .map(|items| {
                items
                    .into_iter()
                    .map(|mut item| {
                        item.adapter_id = self.manifest.id.clone();
                        item
                    })
                    .collect()
            })
            .map_err(|e| AcquisitionError::Driver(e.to_string()))
    }

    fn manifest(&self) -> &DriverManifest {
        &self.manifest
    }

    fn config_schema(&self) -> DriverSchema {
        let defaults =
            serde_json::to_value(&self.defaults).expect("transport config is serializable");
        let params = defaults["params"]
            .as_object()
            .expect("transport parameters are objects");
        let properties: serde_json::Map<String, Value> = params
            .iter()
            .map(|(key, value)| (key.clone(), field_schema(key, value)))
            .collect();
        DriverSchema {
            schema_version: 1,
            json_schema: json!({ "type": "object", "properties": properties,
            "required": params.keys().collect::<Vec<_>>(), "additionalProperties": false }),
            ui_hints: json!({}),
        }
    }

    fn adapter_capability(&self) -> AdapterCapability {
        let schema = self.config_schema();
        let transport = match self.defaults {
            TransportConfig::Udp(_) => TransportKind::Udp,
            TransportConfig::TcpClient(_) | TransportConfig::TcpServer(_) => TransportKind::Tcp,
            TransportConfig::CandleLight(_) => TransportKind::Usb,
            _ => TransportKind::Serial,
        };
        let direction = if matches!(self.defaults, TransportConfig::TcpServer(_)) {
            EndpointDirection::Server
        } else {
            EndpointDirection::Peer
        };
        AdapterCapability {
            contract_version: CAPABILITY_CONTRACT_VERSION,
            adapter_id: self.manifest.id.clone(),
            display_name: self.manifest.display_name.clone(),
            protocol: ProtocolKind::Bytes,
            transport,
            direction,
            operations: self.manifest.capabilities,
            data_domains: self.manifest.payload_kinds.clone(),
            display: None,
            endpoints: vec![EndpointDescriptor {
                id: "device".into(),
                display_name: self.manifest.display_name.clone(),
                transport,
                direction,
                status: RuntimeStatus {
                    state: RuntimeState::Available,
                    detail: None,
                },
                configuration: ConfigurationSchema {
                    schema_version: schema.schema_version,
                    json_schema: schema.json_schema,
                    ui_hints: schema.ui_hints,
                },
                ports: [("tx", PortDirection::Input), ("rx", PortDirection::Output)]
                    .into_iter()
                    .map(|(id, direction)| PortDescriptor {
                        id: id.into(),
                        display_name: id.into(),
                        direction,
                        data_domain: PayloadKind::Bytes,
                        operations: self.manifest.capabilities,
                        address_space: None,
                        data_types: BTreeSet::new(),
                        display: None,
                    })
                    .collect(),
                display: None,
            }],
        }
    }

    fn validate(&self, payload: &DriverPayload) -> AcquisitionResult<ValidatedConfig> {
        let config = self.config(payload)?;
        let backend = self.backend.clone();
        let capabilities = self.manifest.capabilities;
        Ok(ValidatedConfig::new(
            self.manifest.id.clone(),
            move |context| {
                Box::pin(async move {
                    let connection = backend
                        .open(
                            config.clone(),
                            TestDataLink {
                                protocol: ProtocolConfig::RawData,
                                schema: None,
                            },
                        )
                        .await
                        .map_err(|e| AcquisitionError::Driver(e.to_string()))?;
                    Ok(Box::new(ByteSession {
                        handle: TransportHandle::new(connection, config, context.connection_epoch),
                        epoch: context.connection_epoch,
                        capabilities: SessionCapabilities {
                            available: capabilities,
                            max_read_points: 0,
                            max_write_points: 0,
                            min_period_ms: None,
                            max_period_ms: None,
                            source_timestamps: false,
                            server_timestamps: false,
                            idempotent_writes: false,
                        },
                    }) as Box<dyn SourceSession>)
                })
            },
        ))
    }
}

struct ByteSession {
    handle: TransportHandle,
    epoch: u64,
    capabilities: SessionCapabilities,
}

/// 单个传输参数的 schema 字段 — 默认值取自出厂配置, 枚举约束按字段名注入。
fn field_schema(key: &str, default: &Value) -> Value {
    let mut field = json!({ "type": if default.is_number() { "integer" } else { "string" }, "default": default });
    match key {
        "port" | "remote_port" | "listen_port" => {
            field["minimum"] = json!(1);
            field["maximum"] = json!(65535);
        }
        "local_port" => {
            field["minimum"] = json!(0);
            field["maximum"] = json!(65535);
        }
        "baud_rate" => {
            field["minimum"] = json!(1);
        }
        "data_bits" => {
            field["enum"] = json!([5, 6, 7, 8]);
        }
        "parity" => {
            field["enum"] = json!(["none", "odd", "even"]);
        }
        "stop_bits" => {
            field["enum"] = json!(["one", "two"]);
        }
        "flow_control" => {
            field["enum"] = json!(["none", "software", "hardware"]);
        }
        "can_bitrate" => {
            field["enum"] = json!(can_bitrate_candidates());
        }
        _ => {}
    }
    field
}

/// can_bitrate 候选值 — 直接序列化 [`CanBitrate::ALL`], 与 Rust 枚举零漂移。
fn can_bitrate_candidates() -> Vec<Value> {
    CanBitrate::ALL
        .iter()
        .map(|bitrate| serde_json::to_value(bitrate).expect("CanBitrate is serializable"))
        .collect()
}

#[async_trait]
impl SourceSession for ByteSession {
    fn epoch(&self) -> u64 {
        self.epoch
    }
    fn capabilities(&self) -> &SessionCapabilities {
        &self.capabilities
    }
    fn byte_stream(&self) -> Option<&TransportHandle> {
        Some(&self.handle)
    }
    async fn stopped(&self) -> AcquisitionResult<()> {
        self.handle.wait_closed().await;
        Ok(())
    }
    async fn close(&self) -> AcquisitionResult<()> {
        self.handle.close();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 防漂移桥接: schema 枚举必须等于 `CanBitrate::ALL` 的序列化结果,
    /// 且每个候选都能被 `CanBitrate` 反序列化接受 (曾因手写 `Bps1M` 大小写漂移)。
    #[test]
    fn can_bitrate_schema_enum_matches_rust_variants() {
        let expected: Vec<Value> = CanBitrate::ALL
            .iter()
            .map(|bitrate| serde_json::to_value(bitrate).unwrap())
            .collect();
        let field = field_schema("can_bitrate", &json!("Bps500k"));
        assert_eq!(field["enum"], json!(expected));
        for candidate in field["enum"].as_array().unwrap() {
            serde_json::from_value::<CanBitrate>(candidate.clone()).unwrap();
        }
    }

    /// 修复前 schema 里的非法字面量: 不允许重新出现在候选列表;
    /// 反序列化兜底仍接受旧值, 保证旧工作区可加载。
    #[test]
    fn can_bitrate_schema_enum_rejects_legacy_mistyped_names() {
        let field = field_schema("can_bitrate", &json!("Bps500k"));
        for candidate in field["enum"].as_array().unwrap() {
            assert_ne!(candidate, &json!("Bps1M"));
        }
        assert!(serde_json::from_value::<CanBitrate>(json!("Bps1M")).is_ok());
        assert!(serde_json::from_value::<CanBitrate>(json!("Bps10k")).is_ok());
    }

    /// 数值/字符串默认值决定字段类型, 枚举字段不带类型约束之外的信息。
    #[test]
    fn field_schema_defaults_from_value_shape() {
        let numeric = field_schema("baud_rate", &json!(115200));
        assert_eq!(numeric["type"], "integer");
        assert_eq!(numeric["minimum"], 1);
        assert!(numeric.get("enum").is_none());

        let textual = field_schema("port_name", &json!(""));
        assert_eq!(textual["type"], "string");
        assert_eq!(textual["default"], "");
        assert!(textual.get("enum").is_none());
    }
}

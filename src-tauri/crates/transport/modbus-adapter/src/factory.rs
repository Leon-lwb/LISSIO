use crate::client::{ModbusSession, RuntimeConfig, descriptors};
use crate::descriptor::{
    capability_set, rtu_adapter_capability, rtu_capability_set, rtu_configuration_schema,
    tcp_adapter_capability, tcp_configuration_schema,
};
use crate::{DRIVER_ID, ModbusConfig, ModbusRtuConfig, RTU_DRIVER_ID, SCHEMA_VERSION};
use acquisition::{
    AcquisitionError, AcquisitionResult, AdapterCapability, DiscoveredEndpoint, DriverManifest,
    DriverSchema, SourceFactory, SourceSession, ValidatedConfig,
};
use async_trait::async_trait;
use data_model::device::{DriverId, DriverPayload};
use flow::PayloadKind;
use points::PointDescriptor;
use std::collections::BTreeSet;

pub struct ModbusFactory {
    manifest: DriverManifest,
}

pub struct ModbusRtuFactory {
    manifest: DriverManifest,
}

impl Default for ModbusFactory {
    fn default() -> Self {
        Self {
            manifest: manifest(DRIVER_ID, "Modbus TCP"),
        }
    }
}

impl Default for ModbusRtuFactory {
    fn default() -> Self {
        Self {
            manifest: DriverManifest {
                id: DriverId(RTU_DRIVER_ID.into()),
                display_name: "Modbus RTU".into(),
                payload_kinds: BTreeSet::from([PayloadKind::Points]),
                capabilities: rtu_capability_set(),
            },
        }
    }
}

fn manifest(id: &str, display_name: &str) -> DriverManifest {
    DriverManifest {
        id: DriverId(id.into()),
        display_name: display_name.into(),
        payload_kinds: BTreeSet::from([PayloadKind::Points]),
        capabilities: capability_set(),
    }
}

#[async_trait]
impl SourceFactory for ModbusFactory {
    fn manifest(&self) -> &DriverManifest {
        &self.manifest
    }

    fn config_schema(&self) -> DriverSchema {
        driver_schema(tcp_configuration_schema())
    }

    fn adapter_capability(&self) -> AdapterCapability {
        tcp_adapter_capability(&self.manifest)
    }

    fn validate(&self, input: &DriverPayload) -> AcquisitionResult<ValidatedConfig> {
        validate_payload(input, DRIVER_ID)?;
        let config: ModbusConfig = decode_config(input)?;
        config.validate().map_err(invalid_config)?;
        Ok(ValidatedConfig::new(
            DriverId(DRIVER_ID.into()),
            move |context| {
                Box::pin(async move {
                    let session =
                        ModbusSession::connect(RuntimeConfig::Tcp(config), context).await?;
                    Ok(Box::new(session) as Box<dyn SourceSession>)
                })
            },
        ))
    }

    fn point_descriptors(&self, input: &DriverPayload) -> AcquisitionResult<Vec<PointDescriptor>> {
        validate_payload(input, DRIVER_ID)?;
        let config: ModbusConfig = decode_config(input)?;
        config.validate().map_err(invalid_config)?;
        Ok(descriptors(&config.points))
    }
}

#[async_trait]
impl SourceFactory for ModbusRtuFactory {
    fn manifest(&self) -> &DriverManifest {
        &self.manifest
    }

    fn config_schema(&self) -> DriverSchema {
        driver_schema(rtu_configuration_schema())
    }

    fn adapter_capability(&self) -> AdapterCapability {
        rtu_adapter_capability(&self.manifest)
    }

    fn discover(&self) -> AcquisitionResult<Vec<DiscoveredEndpoint>> {
        let ports = serial::serial::list_ports()
            .map_err(|error| AcquisitionError::Driver(error.to_string()))?;
        Ok(ports
            .into_iter()
            .map(|port| {
                let metadata = serial::port_metadata(&port);
                DiscoveredEndpoint {
                    adapter_id: DriverId(RTU_DRIVER_ID.into()),
                    discovery_id: port.name.clone(),
                    display_name: port
                        .description
                        .or(port.product)
                        .unwrap_or_else(|| port.name.clone()),
                    configuration_patch: serde_json::json!({"portName": port.name}),
                    metadata,
                }
            })
            .collect())
    }

    fn validate(&self, input: &DriverPayload) -> AcquisitionResult<ValidatedConfig> {
        validate_payload(input, RTU_DRIVER_ID)?;
        let config: ModbusRtuConfig = decode_config(input)?;
        config.validate().map_err(invalid_config)?;
        Ok(ValidatedConfig::new(
            DriverId(RTU_DRIVER_ID.into()),
            move |context| {
                Box::pin(async move {
                    let session =
                        ModbusSession::connect(RuntimeConfig::Rtu(config), context).await?;
                    Ok(Box::new(session) as Box<dyn SourceSession>)
                })
            },
        ))
    }

    fn point_descriptors(&self, input: &DriverPayload) -> AcquisitionResult<Vec<PointDescriptor>> {
        validate_payload(input, RTU_DRIVER_ID)?;
        let config: ModbusRtuConfig = decode_config(input)?;
        config.validate().map_err(invalid_config)?;
        Ok(descriptors(&config.points))
    }
}

fn driver_schema(schema: acquisition::ConfigurationSchema) -> DriverSchema {
    DriverSchema {
        schema_version: schema.schema_version,
        json_schema: schema.json_schema,
        ui_hints: schema.ui_hints,
    }
}

fn decode_config<T: serde::de::DeserializeOwned>(input: &DriverPayload) -> AcquisitionResult<T> {
    serde_json::from_value(input.payload.clone())
        .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))
}

fn invalid_config(error: crate::PlanError) -> AcquisitionError {
    AcquisitionError::InvalidConfig(error.to_string())
}

fn validate_payload(input: &DriverPayload, expected_driver_id: &str) -> AcquisitionResult<()> {
    if input.driver_id.0 != expected_driver_id {
        return Err(AcquisitionError::DriverMismatch {
            expected: expected_driver_id.into(),
            actual: input.driver_id.0.clone(),
        });
    }
    if input.schema_version != SCHEMA_VERSION {
        return Err(AcquisitionError::InvalidConfig(format!(
            "Modbus payload schema version must be {SCHEMA_VERSION}"
        )));
    }
    Ok(())
}

use crate::client::{S7Session, descriptors};
use crate::descriptor::{adapter_capability, capability_set, configuration_schema};
use crate::{DRIVER_ID, S7Config, SCHEMA_VERSION};
use acquisition::{
    AcquisitionError, AcquisitionResult, AdapterCapability, DriverManifest, DriverSchema,
    SourceFactory, SourceSession, ValidatedConfig,
};
use async_trait::async_trait;
use data_model::device::{DriverId, DriverPayload};
use flow::PayloadKind;
use points::PointDescriptor;
use std::collections::BTreeSet;

pub struct S7Factory {
    manifest: DriverManifest,
}

impl Default for S7Factory {
    fn default() -> Self {
        Self {
            manifest: DriverManifest {
                id: DriverId(DRIVER_ID.into()),
                display_name: "Siemens S7".into(),
                payload_kinds: BTreeSet::from([PayloadKind::Points]),
                capabilities: capability_set(),
            },
        }
    }
}

#[async_trait]
impl SourceFactory for S7Factory {
    fn manifest(&self) -> &DriverManifest {
        &self.manifest
    }

    fn config_schema(&self) -> DriverSchema {
        let schema = configuration_schema();
        DriverSchema {
            schema_version: schema.schema_version,
            json_schema: schema.json_schema,
            ui_hints: schema.ui_hints,
        }
    }

    fn adapter_capability(&self) -> AdapterCapability {
        adapter_capability(&self.manifest)
    }

    fn validate(&self, input: &DriverPayload) -> AcquisitionResult<ValidatedConfig> {
        validate_payload(input)?;
        let config: S7Config = decode_config(input)?;
        config
            .validate()
            .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))?;
        Ok(ValidatedConfig::new(
            DriverId(DRIVER_ID.into()),
            move |context| {
                Box::pin(async move {
                    let session = S7Session::connect(config, context).await?;
                    Ok(Box::new(session) as Box<dyn SourceSession>)
                })
            },
        ))
    }

    fn point_descriptors(&self, input: &DriverPayload) -> AcquisitionResult<Vec<PointDescriptor>> {
        validate_payload(input)?;
        let config: S7Config = decode_config(input)?;
        config
            .validate()
            .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))?;
        Ok(descriptors(&config.points))
    }
}

fn decode_config(input: &DriverPayload) -> AcquisitionResult<S7Config> {
    serde_json::from_value(input.payload.clone())
        .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))
}

fn validate_payload(input: &DriverPayload) -> AcquisitionResult<()> {
    if input.driver_id.0 != DRIVER_ID {
        return Err(AcquisitionError::DriverMismatch {
            expected: DRIVER_ID.into(),
            actual: input.driver_id.0.clone(),
        });
    }
    if input.schema_version != SCHEMA_VERSION {
        return Err(AcquisitionError::InvalidConfig(format!(
            "S7 payload schema version must be {SCHEMA_VERSION}"
        )));
    }
    Ok(())
}

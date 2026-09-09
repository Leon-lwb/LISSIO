use crate::{CapabilitySet, DriverId};
use flow::PayloadKind;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Wire contract version for adapter, endpoint, port, and schema descriptors.
pub const CAPABILITY_CONTRACT_VERSION: u32 = 1;

/// Protocol identity is explicit on the wire and never inferred from a Rust
/// type or a frontend renderer name.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProtocolKind {
    Bytes,
    ModbusTcp,
    ModbusRtu,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransportKind {
    Udp,
    Usb,
    Tcp,
    Serial,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EndpointDirection {
    Client,
    Server,
    Peer,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PortDirection {
    Input,
    Output,
    Bidirectional,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeState {
    Available,
    Unavailable,
    Experimental,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub state: RuntimeState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationSchema {
    pub schema_version: u32,
    pub json_schema: Value,
    #[serde(default)]
    pub ui_hints: Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressRegion {
    pub id: String,
    pub display_name: String,
    pub minimum: u64,
    pub maximum: u64,
    pub readable: bool,
    pub writable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressSpaceDescriptor {
    pub unit: String,
    pub regions: Vec<AddressRegion>,
}

/// Optional visual meaning. Values are semantic hints, not component names.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplaySemantics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub tags: BTreeSet<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortDescriptor {
    pub id: String,
    pub display_name: String,
    pub direction: PortDirection,
    pub data_domain: PayloadKind,
    pub operations: CapabilitySet,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address_space: Option<AddressSpaceDescriptor>,
    #[serde(default)]
    pub data_types: BTreeSet<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<DisplaySemantics>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointDescriptor {
    pub id: String,
    pub display_name: String,
    pub transport: TransportKind,
    pub direction: EndpointDirection,
    pub status: RuntimeStatus,
    pub ports: Vec<PortDescriptor>,
    pub configuration: ConfigurationSchema,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<DisplaySemantics>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterCapability {
    pub contract_version: u32,
    pub adapter_id: DriverId,
    pub display_name: String,
    pub protocol: ProtocolKind,
    pub transport: TransportKind,
    pub direction: EndpointDirection,
    pub operations: CapabilitySet,
    pub data_domains: BTreeSet<PayloadKind>,
    pub endpoints: Vec<EndpointDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<DisplaySemantics>,
}

/// A concrete endpoint option found by an adapter. The configuration patch is
/// merged into that adapter's schema defaults and remains protocol-neutral.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredEndpoint {
    pub adapter_id: DriverId,
    pub discovery_id: String,
    pub display_name: String,
    pub configuration_patch: Value,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_values_are_stable_and_renderer_neutral() {
        assert_eq!(
            serde_json::to_value(ProtocolKind::ModbusTcp).unwrap(),
            serde_json::json!("modbus-tcp")
        );
        assert_eq!(
            serde_json::to_value(ProtocolKind::ModbusRtu).unwrap(),
            serde_json::json!("modbus-rtu")
        );
        let serialized = serde_json::to_string(&DisplaySemantics {
            category: Some("industrial-control".into()),
            symbol: Some("registers".into()),
            tags: BTreeSet::new(),
        })
        .unwrap();
        assert!(!serialized.contains("Component"));
        assert!(!serialized.contains("Renderer"));
    }
}

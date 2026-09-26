//! Renderer-neutral contracts for the backend-owned model catalog.
//!
//! This module is the shared owner of:
//! - [`ConfigurationSchema`]: the configuration schema carrier previously
//!   defined in `acquisition::capabilities`. It lives here so L0/L1 owners
//!   (e.g. `kind`) can describe models without depending on an L2 crate.
//!   The JSON spelling is unchanged.
//! - [`ModelCatalog`] / [`ModelDescriptor`]: the read-only description of
//!   every business model a backend can create or configure. Descriptors are
//!   built from actually registered domain objects — never a second global
//!   table.
//! - Structured issue and port-domain vocabulary shared by the catalog and
//!   the document prepare/describe use cases.
//!
//! Everything here is pure data: no registry instances, drivers, SDKs, or UI
//! components. Wire spellings are frozen; the frontend consumes generated
//! TypeScript for these types.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Wire contract version of [`ModelCatalog`]. Bump when the descriptor
/// structure itself changes; consumers that do not support a version show a
/// compatibility error instead of guessing.
pub const MODEL_CATALOG_CONTRACT_VERSION: u32 = 1;

/// Shared configuration schema carrier for drivers, adapters, and models.
///
/// `json_schema` is restricted to the form-schema subset this project
/// supports (no `$ref`/`oneOf`); `ui_hints` carries renderer-neutral display
/// hints as open JSON.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationSchema {
    pub schema_version: u32,
    pub json_schema: Value,
    #[serde(default)]
    pub ui_hints: Value,
}

impl ConfigurationSchema {
    /// A schema that accepts any object — for models whose parameters are
    /// still free-form JSON (e.g. driver passthrough payloads).
    pub fn open(schema_version: u32) -> Self {
        Self {
            schema_version,
            json_schema: serde_json::json!({"type": "object"}),
            ui_hints: Value::Null,
        }
    }
}

/// Severity of a structured catalog/prepare/describe issue.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum IssueSeverity {
    Info,
    Warning,
    Error,
}

/// Structured, renderer-neutral issue. `code` is a stable machine identifier;
/// `path` points at the offending configuration field when known.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ModelIssue {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub message: String,
    pub severity: IssueSeverity,
}

/// Port data-domain vocabulary shared by graph derivation and node
/// descriptions. Wire spelling matches the historical `GraphDerived` domains.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "PascalCase")]
pub enum NodePortDomain {
    Points,
    F32,
    Bytes,
    String,
    Spectrum,
}

/// One port of a node description: stable handle plus the data and connection
/// semantics the frontend needs for rendering and connection rules.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct NodePortDescriptor {
    pub handle: String,
    pub label: String,
    pub domain: NodePortDomain,
    /// Domains a connection on this port may carry. Empty means "same as
    /// `domain`".
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connect_domains: Vec<NodePortDomain>,
    /// True when the port comes from configuration (channels, blocks, custom
    /// declarations) rather than being fixed by the model definition.
    #[serde(default)]
    pub dynamic: bool,
    /// Connection limit; absent means unlimited.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_connections: Option<u32>,
}

/// Business family of a catalog entry. Families keep old wire kinds intact —
/// the catalog `id` is an additional stable handle, not a replacement.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum ModelFamily {
    Widget,
    Protocol,
    Device,
    PointSelector,
    AiProvider,
}

/// Actions a client may offer for a model. AI providers are configurable but
/// never masquerade as graph nodes.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum ModelAction {
    CreateNode,
    Configure,
}

/// Presentation hints. Translations, icons, and themes stay client-side;
/// these keys only name them.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ModelDisplay {
    /// i18n key resolved by the frontend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_key: Option<String>,
    /// Stable fallback label used when the key has no translation.
    pub fallback_label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_key: Option<String>,
    /// Catalog category hint; palettes may group by it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// Stable ascending sort key inside a category.
    #[serde(default)]
    pub sort_value: u32,
}

impl ModelDisplay {
    /// A display entry with only a fallback label.
    pub fn fallback(label: impl Into<String>) -> Self {
        Self {
            label_key: None,
            fallback_label: label.into(),
            description_key: None,
            category: None,
            sort_value: 0,
        }
    }
}

/// UI data keys. `renderer_key`/`editor_key` name entries of the frontend UI
/// registry; unknown keys must degrade to an explicit unsupported state.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ModelUiHints {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub renderer_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// A named configuration variant (Math/Str operation, filter preset, ...).
/// The backend factory interprets `config_patch`; the client never merges it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ModelVariant {
    pub id: String,
    pub display: ModelDisplay,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub config_patch: Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum ModelAvailabilityState {
    Available,
    /// Compiled in but restricted in this environment (feature off, missing
    /// hardware support, ...). Distinct from "not registered".
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ModelAvailability {
    pub state: ModelAvailabilityState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl ModelAvailability {
    pub const AVAILABLE: Self = Self {
        state: ModelAvailabilityState::Available,
        reason: None,
    };

    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            state: ModelAvailabilityState::Unavailable,
            reason: Some(reason.into()),
        }
    }
}

/// Backend-owned description of one creatable/configurable business model.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    /// Stable catalog id, e.g. `widget:Math`, `protocol:JustFloat`,
    /// `driver:serial`. Existing wire kinds are unchanged by this id.
    pub id: String,
    pub family: ModelFamily,
    /// Configuration structure version; device models keep their existing
    /// `schemaVersion` values.
    pub schema_version: u32,
    pub display: ModelDisplay,
    pub ui: ModelUiHints,
    pub configuration: ConfigurationSchema,
    /// Default preview without instance identity. Hints only — actual
    /// creation must call the backend factory.
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub default_config: Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<ModelVariant>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<ModelAction>,
    pub availability: ModelAvailability,
}

/// Read-only snapshot of every model this backend can create or configure.
///
/// Returned in stable order. Runtime state (open devices, channels, discovery
/// results) is intentionally excluded — it lives in the dynamic APIs and events.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub contract_version: u32,
    /// Stable opaque revision derived from the registered static
    /// descriptions; changes whenever any descriptor changes.
    pub revision: String,
    pub models: Vec<ModelDescriptor>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configuration_schema_keeps_acquisition_json_spelling() {
        let schema = ConfigurationSchema {
            schema_version: 1,
            json_schema: serde_json::json!({"type": "object"}),
            ui_hints: serde_json::json!({}),
        };
        let wire = serde_json::to_value(&schema).unwrap();
        assert_eq!(
            wire,
            serde_json::json!({
                "schemaVersion": 1,
                "jsonSchema": {"type": "object"},
                "uiHints": {},
            })
        );
    }

    #[test]
    fn port_domain_wire_spelling_matches_graph_derived_history() {
        assert_eq!(
            serde_json::to_value(NodePortDomain::F32).unwrap(),
            serde_json::json!("F32")
        );
        assert_eq!(
            serde_json::to_value(NodePortDomain::Spectrum).unwrap(),
            serde_json::json!("Spectrum")
        );
        assert_eq!(
            serde_json::to_value(NodePortDomain::Points).unwrap(),
            serde_json::json!("Points")
        );
    }

    #[test]
    fn descriptor_wire_uses_camel_case_and_skips_empty_collections() {
        let descriptor = ModelDescriptor {
            id: "widget:Math".into(),
            family: ModelFamily::Widget,
            schema_version: 1,
            display: ModelDisplay::fallback("Math"),
            ui: ModelUiHints::default(),
            configuration: ConfigurationSchema::open(1),
            default_config: Value::Null,
            variants: Vec::new(),
            actions: vec![ModelAction::CreateNode],
            availability: ModelAvailability::unavailable("feature disabled"),
        };
        let wire = serde_json::to_value(&descriptor).unwrap();
        let obj = wire.as_object().unwrap();
        assert_eq!(obj["id"], "widget:Math");
        assert_eq!(obj["family"], "widget");
        assert_eq!(obj["schemaVersion"], 1);
        assert_eq!(obj["display"]["fallbackLabel"], "Math");
        assert_eq!(obj["actions"], serde_json::json!(["createNode"]));
        assert_eq!(obj["availability"]["state"], "unavailable");
        assert_eq!(obj["availability"]["reason"], "feature disabled");
        assert!(!obj.contains_key("variants"));
        assert!(!obj.contains_key("defaultConfig"));
    }
}

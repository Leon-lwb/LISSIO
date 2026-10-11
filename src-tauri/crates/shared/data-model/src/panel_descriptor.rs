//! Panel catalog contracts — data-driven display panels as backend-owned models.
//!
//! A **panel** is the window/dock-facing side of a display widget: it names the
//! tab it opens, the delivery modes the backend offers for its data, and how the
//! panel binds to graph nodes. Only *data-driven* panels are described here —
//! pure application chrome (`compile-errors`, `operation-history`,
//! `node-properties`, `recording-database`) stays outside this vocabulary.
//!
//! This module is pure data, mirroring [`crate::model_descriptor`]: the
//! frontend consumes generated TypeScript, the backend projects descriptors
//! from actually registered widgets (`kind::widgets`), and nothing here refers
//! to UI components or SDKs.
//!
//! Versioning: the panel section travels inside
//! [`crate::model_descriptor::ModelCatalog`] and is gated by that catalog's
//! single [`crate::model_descriptor::MODEL_CATALOG_CONTRACT_VERSION`] — there
//! is deliberately no second version to keep in sync.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model_descriptor::{
    ConfigurationSchema, ModelDisplay, ModelUiHints, NodePortDescriptor,
};

/// Stable identity of a data-driven panel.
///
/// Wire spelling is kebab-case and independent of the frontend tab identifier
/// ([`PanelDescriptor::tab_type`]); several panel kinds may share a tab type
/// family.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
pub enum PanelKind {
    Waveform,
    Raw,
    Spectrum,
    Can,
    Logic,
    TableView,
    Model3d,
    Pie,
    Image,
    Command,
    FrameDecoder,
    Trigger,
}

impl PanelKind {
    /// Stable wire spelling (same value used by the catalog `id` suffix).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Waveform => "waveform",
            Self::Raw => "raw",
            Self::Spectrum => "spectrum",
            Self::Can => "can",
            Self::Logic => "logic",
            Self::TableView => "table-view",
            Self::Model3d => "model3d",
            Self::Pie => "pie",
            Self::Image => "image",
            Self::Command => "command",
            Self::FrameDecoder => "frame-decoder",
            Self::Trigger => "trigger",
        }
    }
}

/// Canonical data-plane operation names — the single spelling shared by three
/// surfaces that must never drift apart:
///
/// 1. `kind::widgets::PanelSpec` (`push_request` / `fetch_op`);
/// 2. the `DisplayRequest` serde tags the push channel is keyed by;
/// 3. the panel fetch dispatcher (`control_api::panel_data`).
///
/// (2) is a type owned by the desktop composition root, so it cannot be
/// imported here; the `app::display::protocol` tests assert its serde tags
/// against these constants instead. That keeps the vocabulary authoritative
/// even though the definitions live in different crates.
pub mod panel_ops {
    // ---- push: `DisplayRequest` wire tags (snake_case) ----
    /// Per-port numeric sample stream (`DisplayRequest::PortSamples`).
    pub const PUSH_PORT_SAMPLES: &str = "port_samples";
    /// Waveform window binary stream (`DisplayRequest::Waveform`).
    pub const PUSH_WAVEFORM: &str = "waveform";
    /// FFT result batches (`DisplayRequest::Spectrum`).
    pub const PUSH_SPECTRUM: &str = "spectrum";
    /// Raw byte batches (`DisplayRequest::RawData`).
    pub const PUSH_RAW_DATA: &str = "raw_data";
    /// CAN frame batches (`DisplayRequest::CanFrames`).
    pub const PUSH_CAN_FRAMES: &str = "can_frames";
    /// Logic analyzer sample batches (`DisplayRequest::LogicSamples`).
    pub const PUSH_LOGIC_SAMPLES: &str = "logic_samples";
    /// Decoded protocol event batches (`DisplayRequest::DecodedEvents`).
    pub const PUSH_DECODED_EVENTS: &str = "decoded_events";

    // ---- fetch: one-shot panel reads (camelCase) ----
    /// Latest waveform window for one source node.
    pub const FETCH_WAVEFORM_WINDOW: &str = "waveformWindow";
    /// Latest FFT results, keyed by sink node id.
    pub const FETCH_SPECTRUM: &str = "spectrum";
    /// Latest raw byte batch for one origin.
    pub const FETCH_RAW_DATA: &str = "rawData";
    /// Recent CAN frames.
    pub const FETCH_CAN_FRAMES: &str = "canFrames";
    /// Recent logic analyzer samples.
    pub const FETCH_LOGIC_SAMPLES: &str = "logicSamples";
    /// Recent decoded protocol events.
    pub const FETCH_DECODED_EVENTS: &str = "decodedEvents";
    /// Current numeric output snapshot (the graph plane).
    pub const FETCH_GRAPH_OUTPUTS: &str = "graphOutputs";

    /// Every push name, for uniqueness/convention assertions.
    pub const ALL_PUSH: &[&str] = &[
        PUSH_PORT_SAMPLES,
        PUSH_WAVEFORM,
        PUSH_SPECTRUM,
        PUSH_RAW_DATA,
        PUSH_CAN_FRAMES,
        PUSH_LOGIC_SAMPLES,
        PUSH_DECODED_EVENTS,
    ];

    /// Every fetch name, for uniqueness/convention assertions.
    pub const ALL_FETCH: &[&str] = &[
        FETCH_WAVEFORM_WINDOW,
        FETCH_SPECTRUM,
        FETCH_RAW_DATA,
        FETCH_CAN_FRAMES,
        FETCH_LOGIC_SAMPLES,
        FETCH_DECODED_EVENTS,
        FETCH_GRAPH_OUTPUTS,
    ];
}

/// Delivery modes a panel's data plane supports.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum PanelDelivery {
    /// Pull only (one-shot reads; no subscription loop).
    Fetch,
    /// Push only (subscription stream).
    Push,
    /// Both push and pull address the same panel port.
    Both,
    /// The panel is declared but its data plane is not implemented yet: neither
    /// push nor pull addresses it (`Image` today). Declared explicitly rather
    /// than faking a fetch operation the backend cannot serve — the frontend
    /// renders a placeholder and knows not to subscribe.
    Unavailable,
}

impl PanelDelivery {
    /// Whether the panel supports subscription (push) delivery.
    pub const fn supports_push(self) -> bool {
        matches!(self, Self::Push | Self::Both)
    }

    /// Whether the panel supports one-shot (fetch) delivery.
    pub const fn supports_fetch(self) -> bool {
        matches!(self, Self::Fetch | Self::Both)
    }

    /// Whether the panel has a data plane at all.
    pub const fn is_available(self) -> bool {
        !matches!(self, Self::Unavailable)
    }
}

/// How a panel resolves the graph nodes it displays.
///
/// This formalizes the three mechanisms the frontend used to mix ad hoc:
/// canvas edges, a configuration field, and panel-level singletons.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PanelBinding {
    /// Bound by canvas edges: the panel follows the first upstream edge feeding
    /// each of `input_handles`.
    EdgeBound {
        /// Input handles the panel reads, in display order.
        #[serde(rename = "inputHandles")]
        input_handles: Vec<String>,
    },
    /// Bound by a configuration field holding a port reference
    /// (`port_template`, e.g. `src:{source}:{handle}`).
    ConfigBound {
        /// Parameter name holding the selected port reference.
        #[serde(rename = "configKey")]
        config_key: String,
        /// Port reference template with `{source}` / `{handle}` placeholders.
        #[serde(rename = "portTemplate")]
        port_template: String,
    },
    /// Whole-buffer panel bound to no single node (e.g. CAN bus, logic analyzer).
    Singleton,
    /// Panel addresses a node through one of its own parameters.
    NodeScoped {
        /// Parameter name holding the target node id.
        #[serde(rename = "nodeIdParam")]
        node_id_param: String,
    },
}

/// Data plane of a panel: which push request and which fetch operation address
/// its data, plus the default pacing hints for a subscription.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct PanelDataPlane {
    /// Delivery modes this panel supports.
    pub delivery: PanelDelivery,
    /// Stable display-request kind used for push delivery — the
    /// [`panel_ops`] push name, spelling-identical to the `DisplayRequest`
    /// serde tag (e.g. `"port_samples"`, `"waveform"`, `"raw_data"`). Absent
    /// when the panel is pull-only or has no data plane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push_request: Option<String>,
    /// Stable fetch operation name used for pull delivery — the [`panel_ops`]
    /// fetch name (e.g. `"waveformWindow"`, `"graphOutputs"`). Absent when the
    /// panel is push-only or has no data plane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fetch_op: Option<String>,
    /// Suggested subscription interval in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_interval_ms: Option<u32>,
    /// Suggested subscription batch cap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_max_items: Option<u32>,
}

/// Backend-owned description of one data-driven panel.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct PanelDescriptor {
    /// Stable catalog id, e.g. `panel:waveform`.
    pub id: String,
    pub kind: PanelKind,
    /// Frontend tab type this panel opens (e.g. `"waveform-extra"`, `"table-view"`).
    pub tab_type: String,
    pub display: ModelDisplay,
    pub ui: ModelUiHints,
    /// Host widget kind that owns this panel on the canvas; `None` for panels
    /// without a canvas node (CAN bus, logic analyzer).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_widget_kind: Option<String>,
    /// Default panel parameters, without instance identity (hints only).
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub default_params: Value,
    pub configuration: ConfigurationSchema,
    pub data_plane: PanelDataPlane,
    pub binding: PanelBinding,
    /// Panel-facing input ports; same vocabulary as `describe_node_documents`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inputs: Vec<NodePortDescriptor>,
    /// Panel-facing output ports.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outputs: Vec<NodePortDescriptor>,
}

#[cfg(test)]
#[path = "panel_descriptor_tests.rs"]
mod tests;

//! One editable document is lowered into ephemeral graph, renderer and layout indexes.
use crate::GraphDerived;
use acquisition::PortDirection;
use app::{SourceGraphs, SourceNodeHint, WidgetRecord, WorkspaceState};
use buffer_graph::Edge;
use data_model::{
    device::{DevicePort, DevicePortDirection, DevicePortDomain},
    Error, Result,
};
use flow::PayloadKind;
use kind::document::{NodeBusiness, NodeDocument};
use pipeline::DataPlaneState;
use std::{
    collections::{HashMap, HashSet},
    sync::{atomic::AtomicU64, Arc},
};
use tauri::AppHandle;

#[allow(clippy::implicit_hasher, clippy::too_many_arguments)]
pub async fn apply_document(
    graphs: &Arc<parking_lot::Mutex<HashMap<String, pipeline::CompiledGraph>>>,
    version: &Arc<AtomicU64>,
    plane: &DataPlaneState,
    sources: &SourceGraphs,
    workspace: &WorkspaceState,
    app: Option<&AppHandle>,
    tab_id: String,
    documents: Vec<NodeDocument>,
    edges: Vec<Edge>,
    base_version: Option<u64>,
) -> Result<GraphDerived> {
    let invalid = |message: String| {
        Error::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            message,
        ))
    };
    let mut ids = HashSet::new();
    for doc in &documents {
        if doc.tab_id != tab_id || !ids.insert(doc.id.clone()) {
            return Err(invalid("node tab ownership or identity is invalid".into()));
        }
    }
    if sources
        .lock()
        .iter()
        .any(|(tab, graph)| tab != &tab_id && graph.nodes.iter().any(|n| ids.contains(&n.id)))
    {
        return Err(invalid("node IDs must be unique across tabs".into()));
    }
    if edges
        .iter()
        .any(|e| !ids.contains(&e.source) || !ids.contains(&e.target))
    {
        return Err(invalid(
            "cross-tab or missing-node connections are not allowed".into(),
        ));
    }
    let selectors = documents
        .iter()
        .filter(|doc| matches!(doc.business, NodeBusiness::PointSelector { .. }))
        .map(|doc| doc.id.as_str())
        .collect::<HashSet<_>>();
    let mut connected_selectors = HashSet::new();
    if edges.iter().any(|edge| {
        selectors.contains(edge.target.as_str())
            && edge.target_handle == "points"
            && !connected_selectors.insert(edge.target.as_str())
    }) {
        return Err(invalid(
            "a point selector accepts exactly one point source".into(),
        ));
    }
    let capabilities = plane.transport.adapter_capabilities();
    let mut nodes = Vec::new();
    let mut widgets = Vec::new();
    let mut hints = HashMap::new();
    for doc in &documents {
        let ports = if let NodeBusiness::Device {
            driver,
            capability_endpoint_id,
            ..
        } = &doc.business
        {
            let adapter = capabilities
                .iter()
                .find(|adapter| adapter.adapter_id == driver.driver_id)
                .ok_or_else(|| invalid(format!("unknown device adapter {}", driver.driver_id.0)))?;
            let endpoint = adapter
                .endpoints
                .iter()
                .find(|endpoint| Some(&endpoint.id) == capability_endpoint_id.as_ref())
                .ok_or_else(|| {
                    invalid(format!(
                        "unknown endpoint for adapter {}",
                        driver.driver_id.0
                    ))
                })?;
            endpoint
                .ports
                .iter()
                .map(|port| DevicePort {
                    id: port.id.clone(),
                    direction: match port.direction {
                        PortDirection::Input => DevicePortDirection::Input,
                        PortDirection::Output => DevicePortDirection::Output,
                        PortDirection::Bidirectional => DevicePortDirection::Bidirectional,
                    },
                    domain: match port.data_domain {
                        PayloadKind::Bytes => DevicePortDomain::Bytes,
                        PayloadKind::Points => DevicePortDomain::Points,
                        PayloadKind::Events => DevicePortDomain::Events,
                        PayloadKind::Numeric => DevicePortDomain::Numeric,
                    },
                })
                .collect()
        } else {
            Vec::new()
        };
        let node = doc.lower(ports).map_err(invalid)?;
        let mut hint = SourceNodeHint::default();
        match &doc.business {
            NodeBusiness::Widget {
                widget_kind,
                params,
                ..
            } => {
                let mut params = params.clone();
                params["id"] = serde_json::json!(doc.id);
                params["label"] = serde_json::json!(doc.label);
                widgets.push(WidgetRecord {
                    id: doc.id.clone(),
                    kind: widget_kind.clone(),
                    params,
                });
                hint.raw_data = widget_kind == "RawData";
                hint.default_input = match widget_kind.as_str() {
                    "Math" | "Filter" | "FFT" => Some("in0".into()),
                    "IFFT" | "Spectrum" => Some("spectrum".into()),
                    "TextDisplay" | "TextOut" => Some("text".into()),
                    "Trigger" => Some("trigger".into()),
                    "RawData" => Some("data".into()),
                    "Waveform" | "PieChart" | "Image" | "Gauge" | "Progress" | "LED"
                    | "NumberDisplay" | "Label" | "Model3D" | "Command" | "TableView" => {
                        Some("value".into())
                    }
                    _ => None,
                };
            }
            NodeBusiness::Device { .. } => {
                if let kind::NodeKind::Acquisition { ports, .. } = &node.kind {
                    hint.default_input = ports
                        .iter()
                        .find(|p| p.direction != DevicePortDirection::Output)
                        .map(|p| p.id.clone());
                    hint.default_output = ports
                        .iter()
                        .find(|p| p.direction != DevicePortDirection::Input)
                        .map(|p| p.id.clone());
                }
            }
            NodeBusiness::Protocol { .. } => {
                hint.default_input = Some("in".into());
                hint.default_output = Some("out".into());
            }
            NodeBusiness::PointSelector { points } => {
                hint.default_input = Some("points".into());
                hint.default_output = points.first().cloned();
            }
        }
        let ports = kind::port_table(&node.kind);
        hint.default_input = hint
            .default_input
            .or_else(|| ports.inputs.first().map(|port| port.handle.into()));
        hint.default_output = hint
            .default_output
            .or_else(|| ports.outputs.first().map(|port| port.handle.into()));
        hints.insert(doc.id.clone(), hint);
        nodes.push(node);
    }
    super::simulation::resolve(&mut nodes, &edges);
    crate::apply_tab_graph_parts(
        graphs,
        version,
        plane,
        sources,
        workspace,
        app,
        tab_id,
        nodes,
        edges,
        hints,
        Some(widgets),
        base_version,
        Some(documents),
    )
    .await
}

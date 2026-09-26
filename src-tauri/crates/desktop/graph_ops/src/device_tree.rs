//! Device declarations are persisted once; protocol nodes and attachment edges are derived.

use buffer_graph::Edge;
use data_model::device::{DevicePortDirection, DevicePortDomain};
use data_model::device_tree::{DeviceTreeDocument, NodeDecl};
use data_model::{Error, Result};
use kind::{NodeDef, NodeKind};
use std::collections::HashSet;

const PROTOCOL_DRIVER: &str = "protocol-engine";

pub fn declaration_ids(node: &NodeDecl) -> Result<Vec<String>> {
    let document = DeviceTreeDocument::new(node.clone());
    document
        .paths()
        .map_err(|error| invalid(error.to_string()))?;
    Ok(document
        .node_ids()
        .into_iter()
        .map(|id| id.to_string())
        .collect())
}

/// Expand protocol children into the existing parser/data plane, preserving their stable ids.
/// Attachment edges are compilation inputs only, never a second persisted topology.
pub fn project(nodes: &mut Vec<NodeDef>, edges: &mut Vec<Edge>) -> Result<()> {
    let roots = nodes.clone();
    let mut ids: HashSet<_> = roots.iter().map(|node| node.id.clone()).collect();
    for root in roots {
        let NodeKind::Acquisition { node, ports } = &root.kind else {
            continue;
        };
        for id in declaration_ids(node)?.into_iter().skip(1) {
            if !ids.insert(id.clone()) {
                return Err(invalid(format!(
                    "device tree node identity {id} is duplicated"
                )));
            }
        }
        let output = ports.iter().find(|port| {
            port.domain == DevicePortDomain::Bytes && port.direction != DevicePortDirection::Input
        });
        project_children(
            node,
            &root.tab_id,
            output.map(|port| (root.id.as_str(), port.id.as_str())),
            node.enabled,
            nodes,
            edges,
        )?;
    }
    Ok(())
}

fn project_children(
    parent: &NodeDecl,
    tab: &str,
    source: Option<(&str, &str)>,
    enabled: bool,
    nodes: &mut Vec<NodeDef>,
    edges: &mut Vec<Edge>,
) -> Result<()> {
    for child in &parent.children {
        if child.driver.as_str() != PROTOCOL_DRIVER {
            // Simulation replaces its parent's source; its protocol children use that source.
            let source = (child.driver.as_str() == "simulation")
                .then_some(source)
                .flatten();
            project_children(child, tab, source, enabled && child.enabled, nodes, edges)?;
            continue;
        }
        let config: schema_types::ProtocolNodeConfig = serde_json::from_value(child.config.clone())
            .map_err(|error| invalid(format!("invalid protocol node {}: {error}", child.id)))?;
        let Some((source_id, source_handle)) = source else {
            return Err(invalid(format!(
                "protocol node {} requires a parent byte source",
                child.id
            )));
        };
        if child.schema_version != 1 {
            return Err(invalid(format!(
                "unsupported protocol node schema version {}",
                child.schema_version
            )));
        }
        let active = enabled && child.enabled;
        let id = child.id.to_string();
        // The tree owns the parser input. A canvas edge cannot bypass its parent or enable flag.
        if edges
            .iter()
            .any(|edge| edge.target == id && edge.target_handle == "in")
        {
            return Err(invalid(format!(
                "protocol node {id} input is supplied by its device tree parent"
            )));
        }
        nodes.push(NodeDef {
            id: id.clone(),
            tab_id: tab.to_string(),
            kind: NodeKind::Protocol {
                config: config.protocol,
                convert_to: config.convert_to,
                schema: config.schema,
            },
        });
        if active {
            edges.push(Edge {
                id: format!("device-tree:{source_id}:{id}"),
                source: source_id.to_string(),
                source_handle: source_handle.to_string(),
                target: id.clone(),
                target_handle: "in".into(),
            });
        }
        project_children(child, tab, Some((&id, "out")), active, nodes, edges)?;
    }
    Ok(())
}

fn invalid(message: String) -> Error {
    Error::Io(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        message,
    ))
}

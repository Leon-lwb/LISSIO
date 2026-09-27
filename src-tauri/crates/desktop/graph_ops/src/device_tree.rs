//! Device declarations are persisted once; protocol nodes and attachment edges are derived.

use buffer_graph::Edge;
use data_model::device::{DevicePortDirection, DevicePortDomain};
use data_model::device_tree::{DeviceTreeDocument, NodeDecl, NodeId, NodePath, NodeRole};
use error::{AppError as Error, Result};

use kind::{NodeDef, NodeKind, NodeOrigin};
use std::collections::{BTreeMap, HashSet};

const PROTOCOL_DRIVER: &str = "protocol-engine";

/// 设备树节点身份表（按树序遍历，含根节点）。
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
///
/// 投影同时为派生的图节点写入 [`NodeOrigin`]：根设备节点与协议子节点都标记为
/// [`NodeOrigin::DeviceTree`]，使编译结果可以按设备树节点反查其派生子图。
pub fn project(nodes: &mut Vec<NodeDef>, edges: &mut Vec<Edge>) -> Result<()> {
    let mut ids: HashSet<String> = nodes.iter().map(|node| node.id.clone()).collect();
    let roots: Vec<usize> = nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| matches!(node.kind, NodeKind::Acquisition { .. }))
        .map(|(index, _)| index)
        .collect();
    for index in roots {
        let NodeKind::Acquisition { node, ports } = &nodes[index].kind else {
            continue;
        };
        let document = DeviceTreeDocument::new(node.clone());
        let paths = document
            .paths()
            .map_err(|error| invalid(error.to_string()))?;
        for id in document.node_ids().into_iter().skip(1) {
            if !ids.insert(id.to_string()) {
                return Err(invalid(format!(
                    "device tree node identity {id} is duplicated"
                )));
            }
        }
        let declaration = node.clone();
        let root_graph_id = nodes[index].id.clone();
        let tab_id = nodes[index].tab_id.clone();
        let source = ports
            .iter()
            .find(|port| {
                port.domain == DevicePortDomain::Bytes
                    && port.direction != DevicePortDirection::Input
            })
            .map(|port| (root_graph_id.clone(), port.id.clone()));
        // 投影起点自身也是设备树节点：路径与身份由同一棵树派生。
        nodes[index].origin = device_origin(&declaration.id, &paths, None, &declaration.id, None)?;
        project_children(
            &declaration,
            &tab_id,
            source
                .as_ref()
                .map(|(node_id, handle)| (node_id.as_str(), handle.as_str())),
            declaration.enabled,
            &paths,
            &declaration.id,
            // 根节点的直接子节点以根设备节点为父。
            Some(&declaration.id),
            nodes,
            edges,
        )?;
    }
    Ok(())
}

/// 由投影出的设备树路径构造 provenance 标记。
fn device_origin(
    node_id: &NodeId,
    paths: &BTreeMap<NodeId, NodePath>,
    role: Option<NodeRole>,
    root: &NodeId,
    parent: Option<&NodeId>,
) -> Result<NodeOrigin> {
    let path = paths
        .get(node_id)
        .ok_or_else(|| invalid(format!("device tree node {node_id} has no derived path")))?
        .clone();
    Ok(NodeOrigin::DeviceTree {
        node_id: node_id.clone(),
        path,
        role,
        root: root.clone(),
        parent: parent.cloned(),
    })
}

fn project_children(
    parent: &NodeDecl,
    tab: &str,
    source: Option<(&str, &str)>,
    enabled: bool,
    paths: &BTreeMap<NodeId, NodePath>,
    root: &NodeId,
    parent_id: Option<&NodeId>,
    nodes: &mut Vec<NodeDef>,
    edges: &mut Vec<Edge>,
) -> Result<()> {
    for child in &parent.children {
        if child.driver.as_str() != PROTOCOL_DRIVER {
            // Simulation replaces its parent's source; its protocol children use that source.
            let source = (child.driver.as_str() == "simulation")
                .then_some(source)
                .flatten();
            project_children(
                child,
                tab,
                source,
                enabled && child.enabled,
                paths,
                root,
                Some(&child.id),
                nodes,
                edges,
            )?;
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
        let origin = device_origin(&child.id, paths, Some(NodeRole::Protocol), root, parent_id)?;
        nodes.push(NodeDef::with_origin(
            id.clone(),
            tab.to_string(),
            NodeKind::Protocol {
                config: config.protocol,
                convert_to: config.convert_to,
                schema: config.schema,
            },
            origin,
        ));
        if active {
            edges.push(Edge {
                id: format!("device-tree:{source_id}:{id}"),
                source: source_id.to_string(),
                source_handle: source_handle.to_string(),
                target: id.clone(),
                target_handle: "in".into(),
            });
        }
        project_children(
            child,
            tab,
            Some((&id, "out")),
            active,
            paths,
            root,
            Some(&child.id),
            nodes,
            edges,
        )?;
    }
    Ok(())
}

fn invalid(message: String) -> Error {
    Error::Io(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        message,
    ))
}

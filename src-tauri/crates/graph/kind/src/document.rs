//! The editable node document. Runtime ports and state are derived, never persisted here.
use crate::{NodeDef, NodeKind};
use data_model::device::DevicePort;
use data_model::device_tree::NodeDecl;
use schema_types::{ProtocolConfig, ProtocolSchema};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeLayout {
    pub x: f64,
    pub y: f64,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "config", rename_all = "camelCase")]
pub enum NodeBusiness {
    Device {
        node: NodeDecl,
    },
    Protocol {
        protocol: ProtocolConfig,
        #[serde(rename = "convertTo")]
        convert_to: Option<ProtocolConfig>,
        schema: ProtocolSchema,
    },
    PointSelector {
        points: Vec<String>,
    },
    Widget {
        #[serde(rename = "widgetKind")]
        widget_kind: String,
        params: Value,
        #[serde(rename = "customPorts")]
        custom_ports: Option<CustomPorts>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CustomPorts {
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDocument {
    pub id: String,
    pub tab_id: String,
    pub label: String,
    pub layout: NodeLayout,
    #[serde(flatten)]
    pub business: NodeBusiness,
}

impl NodeDocument {
    pub fn lower(&self, ports: Vec<DevicePort>) -> Result<NodeDef, String> {
        if self.id.trim().is_empty() || self.label.trim().is_empty() || self.tab_id.is_empty() {
            return Err("node identity, tab and label are required".into());
        }
        if !self.layout.x.is_finite()
            || !self.layout.y.is_finite()
            || [self.layout.width, self.layout.height]
                .into_iter()
                .flatten()
                .any(|v| !v.is_finite() || v <= 0.0)
        {
            return Err("invalid node layout".into());
        }
        let kind = match &self.business {
            NodeBusiness::Device { node } => {
                if node.id.as_str() != self.id || node.name != self.label {
                    return Err("device node identity must match its document identity".into());
                }
                NodeKind::Acquisition {
                    node: node.clone(),
                    ports,
                }
            }
            NodeBusiness::Protocol {
                protocol,
                convert_to,
                schema,
            } => NodeKind::Protocol {
                config: protocol.clone(),
                convert_to: convert_to.clone(),
                schema: Some(schema.clone()),
            },
            NodeBusiness::PointSelector { points } => {
                let unique = points.iter().collect::<std::collections::BTreeSet<_>>();
                if unique.len() != points.len() || points.iter().any(String::is_empty) {
                    return Err("point IDs must be nonempty and unique".into());
                }
                NodeKind::PointSelector {
                    points: points.clone(),
                }
            }
            NodeBusiness::Widget {
                widget_kind,
                params,
                custom_ports,
            } => super::widget_document::lower(widget_kind, params, custom_ports.as_ref())?,
        };
        Ok(NodeDef {
            id: self.id.clone(),
            tab_id: self.tab_id.clone(),
            kind,
        })
    }
}

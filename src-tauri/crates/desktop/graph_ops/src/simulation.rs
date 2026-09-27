//! Resolve a byte simulation's wire format from the same tab document.
use buffer_graph::Edge;
use kind::{NodeDef, NodeKind};
use schema_types::{
    DecoderBlockDef, DecoderChecksumCover, DecoderChecksumPosition, EncodeBlockDef, FieldType,
    ProtocolConfig, ProtocolSchema, SchemaPreset,
};
use std::collections::{HashSet, VecDeque};

pub fn resolve(nodes: &mut [NodeDef], edges: &[Edge]) {
    let snapshot = nodes.to_vec();
    for node in nodes {
        let NodeKind::Acquisition {
            node: device,
            ports,
        } = &mut node.kind
        else {
            continue;
        };
        let Some(simulation_node) = device
            .children
            .iter_mut()
            .find(|child| child.driver.as_str() == data_model::device_tree::SIMULATION_DRIVER_ID)
        else {
            continue;
        };
        let Ok(mut simulation) = serde_json::from_value::<data_model::device::SimulationConfig>(
            simulation_node.config.clone(),
        ) else {
            continue;
        };
        if ports
            .iter()
            .any(|port| port.domain == data_model::device::DevicePortDomain::Points)
        {
            continue;
        }
        let mut queue = VecDeque::from([node.id.clone()]);
        let mut visited = HashSet::from([node.id.clone()]);
        let mut parsers = Vec::new();
        while let Some(source) = queue.pop_front() {
            for edge in edges.iter().filter(|edge| edge.source == source) {
                if !visited.insert(edge.target.clone()) {
                    continue;
                }
                let Some(target) = snapshot.iter().find(|n| n.id == edge.target) else {
                    continue;
                };
                match &target.kind {
                    NodeKind::Protocol { config, schema, .. } => parsers.push((
                        target.id.clone(),
                        Some(serde_json::json!({ "protocol": config, "schema": schema })),
                    )),
                    NodeKind::FrameDecoder { blocks, .. } => {
                        parsers.push((target.id.clone(), frame_decoder_encoding(blocks)));
                    }
                    _ => queue.push_back(target.id.clone()),
                }
            }
        }
        if parsers.is_empty() {
            continue;
        }
        simulation.encoding = simulation.reference_node_id.as_ref().map_or_else(
            || {
                parsers
                    .iter()
                    .all(|(_, encoding)| *encoding == parsers[0].1)
                    .then(|| parsers[0].1.clone())
                    .flatten()
            },
            |id| {
                parsers
                    .iter()
                    .find(|(key, _)| key == id)
                    .and_then(|(_, encoding)| encoding.clone())
            },
        );
        simulation_node.config =
            serde_json::to_value(simulation).expect("simulation configuration is serializable");
    }
}

fn frame_decoder_encoding(blocks: &[DecoderBlockDef]) -> Option<serde_json::Value> {
    let mut encode = Vec::with_capacity(blocks.len());
    for block in blocks {
        encode.push(match block {
            DecoderBlockDef::Header {
                hex,
                match_id: None,
                ..
            }
            | DecoderBlockDef::Tail {
                hex,
                match_id: None,
                ..
            } => EncodeBlockDef::ConstHex { hex: hex.clone() },
            DecoderBlockDef::Field {
                field_type,
                port_name,
                length_ref: None,
                match_id: None,
                ..
            } if *field_type != FieldType::Bytes => EncodeBlockDef::VarRef {
                port_name: port_name.clone(),
                field_type: *field_type,
            },
            DecoderBlockDef::Checksum {
                algorithm,
                custom_script,
                cover: DecoderChecksumCover::AllPrior,
                position,
                match_id: None,
                ..
            } if *position != DecoderChecksumPosition::Prepend => EncodeBlockDef::Checksum {
                algorithm: *algorithm,
                custom_script: custom_script.clone(),
            },
            _ => return None,
        });
    }
    let schema = ProtocolSchema {
        preset: SchemaPreset::Custom,
        preset_config: None,
        decode: blocks.to_vec(),
        encode: Some(encode),
    };
    Some(serde_json::json!({ "protocol": ProtocolConfig::RawData, "schema": schema }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_only_reversible_frame_decoder_layouts() {
        let supported = vec![
            DecoderBlockDef::Header {
                id: "head".into(),
                hex: "AA".into(),
                match_id: None,
            },
            DecoderBlockDef::Field {
                id: "value".into(),
                field_type: FieldType::Float32LE,
                port_name: "value".into(),
                length_ref: None,
                match_id: None,
            },
        ];
        assert!(frame_decoder_encoding(&supported).is_some());

        let unsupported = vec![DecoderBlockDef::Bitfield {
            id: "bits".into(),
            byte_offset: 0,
            bit_offset: 0,
            bit_length: 1,
            is_signed: false,
            port_name: "flag".into(),
            match_id: None,
        }];
        assert!(frame_decoder_encoding(&unsupported).is_none());
    }
}

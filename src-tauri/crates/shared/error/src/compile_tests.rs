use super::*;

#[test]
fn cycle_extracts_nodes() {
    let e = CompileError::Cycle {
        cycle: vec!["a".into(), "b".into(), "a".into()],
    };
    assert_eq!(e.affects_nodes(), vec!["a", "b"]);
    assert!(e.affects_edges().is_empty());
    assert_eq!(e.kind(), "ValueCycle");
}

#[test]
fn byte_cycle_extracts_nodes() {
    let e = CompileError::ByteCycle {
        cycle: vec!["tp".into(), "tp".into()],
    };
    assert_eq!(e.affects_nodes(), vec!["tp"]);
    assert_eq!(e.kind(), "ByteCycle");
}

#[test]
fn domain_mismatch_extracts_both_endpoints_and_edge() {
    let e = CompileError::DomainMismatch {
        edge_id: "e1".into(),
        source_node: "src".into(),
        source_port: "out".into(),
        src_domain: PortDomain::Bytes,
        target: "tgt".into(),
        target_port: "in0".into(),
        tgt_domain: PortDomain::F32,
    };
    let nodes = e.affects_nodes();
    assert_eq!(nodes.len(), 2);
    assert!(nodes.contains(&"src".to_string()));
    assert!(nodes.contains(&"tgt".to_string()));
    assert_eq!(e.affects_edges(), vec!["e1"]);
}

#[test]
fn node_not_found_only_one_node() {
    let e = CompileError::NodeNotFound { id: "ghost".into() };
    assert_eq!(e.affects_nodes(), vec!["ghost"]);
    assert!(e.affects_edges().is_empty());
}

#[test]
fn report_fills_nodes_and_edges_from_error() {
    let err = CompileError::DomainMismatch {
        edge_id: "e1".into(),
        source_node: "src".into(),
        source_port: "out".into(),
        src_domain: PortDomain::String,
        target: "tgt".into(),
        target_port: "in".into(),
        tgt_domain: PortDomain::F32,
    };
    let r = CompileReport::new(err.clone());
    assert_eq!(r.edges, vec!["e1"]);
    assert!(r.nodes.contains(&"src".to_string()));
    assert!(r.nodes.contains(&"tgt".to_string()));
    assert_eq!(r.to_string(), err.to_string());
}

#[test]
fn serde_shape_matches_event_payload() {
    let r = CompileReport::new(CompileError::DomainMismatch {
        edge_id: "e1".into(),
        source_node: "src".into(),
        source_port: "out".into(),
        src_domain: PortDomain::Bytes,
        target: "tgt".into(),
        target_port: "in0".into(),
        tgt_domain: PortDomain::F32,
    });
    let v = serde_json::to_value(&r).expect("serialize");
    assert_eq!(v["error"]["kind"], "domain_mismatch");
    assert_eq!(v["error"]["edge_id"], "e1");
    assert_eq!(v["error"]["src_domain"], "bytes");
    assert_eq!(v["edges"][0], "e1");
    assert_eq!(v["nodes"].as_array().unwrap().len(), 2);
}

#[test]
fn port_domain_str_mapping() {
    assert_eq!(PortDomain::F32.as_str(), "f32");
    assert_eq!(PortDomain::Bytes.as_str(), "bytes");
    assert_eq!(PortDomain::String.as_str(), "string");
}

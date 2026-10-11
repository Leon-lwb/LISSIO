use super::*;
use crate::ports::PortDomain;

#[test]
fn text_input_serde_shape() {
    let json = r#"{"kind":"TextInput","params":{"text":"hi"}}"#;
    let kind: NodeKind = serde_json::from_str(json).expect("TextInput 应反序列化成功");
    match kind {
        NodeKind::TextInput { text } => assert_eq!(text, "hi"),
        other => panic!("expected TextInput, got {other:?}"),
    }
}

#[test]
fn raw_data_handle_prefix() {
    assert!(is_raw_data_handle("src:tp:rx"));
    assert!(!is_raw_data_handle("src"));
    assert!(!is_raw_data_handle("loopbackOut"));
}

#[test]
fn protocol_source_predicate() {
    assert!(is_protocol_source(&NodeKind::ProtocolSource {
        node_id: "p".into(),
        channels: 1,
        port_names: Vec::new(),
    }));
    assert!(!is_protocol_source(&NodeKind::Input));
    assert!(!is_protocol_source(&NodeKind::Sink));
}

#[test]
fn port_domain_import_path_unaffected() {
    // 端口域仍通过 `kind::PortDomain` 暴露，pub use 路径不破坏
    let _: PortDomain = PortDomain::F32;
}

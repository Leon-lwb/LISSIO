use super::*;

#[test]
fn can_frames_request_accepts_frontend_filter_contract() {
    let request: DisplayRequest = serde_json::from_str(
        r#"{"kind":"can_frames","filter":{"id":291,"direction":"Rx","rtr":false}}"#,
    )
    .unwrap();
    let DisplayRequest::CanFrames { filter } = request else {
        panic!("expected can_frames request");
    };
    let filter = filter.unwrap();
    filter.validate().unwrap();
    assert_eq!(filter.id, Some(0x123));
}

#[test]
fn can_frames_request_preserves_unfiltered_shape() {
    let request: DisplayRequest = serde_json::from_str(r#"{"kind":"can_frames"}"#).unwrap();
    assert!(matches!(
        request,
        DisplayRequest::CanFrames { filter: None }
    ));
}

#[test]
fn panel_request_accepts_port_addressing() {
    let request: DisplayRequest = serde_json::from_str(
        r#"{"kind":"panel","node_id":"src","port":"CH0","panel_kind":"waveform"}"#,
    )
    .unwrap();
    let DisplayRequest::Panel {
        node_id,
        port,
        panel_kind,
    } = request
    else {
        panic!("expected panel request");
    };
    assert_eq!(node_id, "src");
    assert_eq!(port, "CH0");
    assert_eq!(panel_kind, PanelKind::Waveform);
}

#[test]
fn panel_request_defaults_to_node_level_addressing() {
    let request: DisplayRequest =
        serde_json::from_str(r#"{"kind":"panel","node_id":"bus","panel_kind":"can"}"#).unwrap();
    let DisplayRequest::Panel {
        node_id,
        port,
        panel_kind,
    } = request
    else {
        panic!("expected panel request");
    };
    assert_eq!(node_id, "bus");
    assert!(port.is_empty(), "缺省 port = 节点级寻址");
    assert_eq!(panel_kind, PanelKind::Can);
}

#[test]
fn panel_request_requires_a_known_panel_kind() {
    // 面板身份是 kebab-case wire 拼写; 未知身份是契约破坏, 直接反序列化失败
    assert!(
        serde_json::from_str::<DisplayRequest>(
            r#"{"kind":"panel","node_id":"n","panel_kind":"hologram"}"#
        )
        .is_err()
    );
}

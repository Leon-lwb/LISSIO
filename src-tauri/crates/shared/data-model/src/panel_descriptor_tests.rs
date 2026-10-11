use super::*;
use crate::model_descriptor::NodePortDomain;

fn descriptor() -> PanelDescriptor {
    PanelDescriptor {
        id: "panel:waveform".to_string(),
        kind: PanelKind::Waveform,
        tab_type: "waveform-extra".to_string(),
        display: ModelDisplay::fallback("Waveform"),
        ui: ModelUiHints {
            renderer_key: Some("Waveform".to_string()),
            editor_key: None,
            icon: None,
        },
        host_widget_kind: Some("Waveform".to_string()),
        default_params: serde_json::json!({"maxPoints": 1000}),
        configuration: ConfigurationSchema::open(1),
        data_plane: PanelDataPlane {
            delivery: PanelDelivery::Both,
            push_request: Some("waveform".to_string()),
            fetch_op: Some("waveformWindow".to_string()),
            default_interval_ms: Some(33),
            default_max_items: Some(1000),
        },
        binding: PanelBinding::EdgeBound {
            input_handles: vec!["value".to_string()],
        },
        inputs: vec![NodePortDescriptor {
            handle: "value".to_string(),
            label: "value".to_string(),
            domain: NodePortDomain::F32,
            connect_domains: Vec::new(),
            dynamic: false,
            max_connections: None,
        }],
        outputs: Vec::new(),
    }
}

#[test]
fn panel_kind_wire_spelling_is_kebab_case() {
    assert_eq!(PanelKind::Waveform.as_str(), "waveform");
    assert_eq!(PanelKind::TableView.as_str(), "table-view");
    assert_eq!(PanelKind::FrameDecoder.as_str(), "frame-decoder");
    assert_eq!(
        serde_json::to_value(PanelKind::Model3d).unwrap(),
        serde_json::json!("model3d")
    );
    assert_eq!(
        serde_json::to_value(PanelKind::TableView).unwrap(),
        serde_json::json!("table-view")
    );
}

#[test]
fn delivery_modes_report_their_capabilities() {
    assert!(PanelDelivery::Both.supports_push());
    assert!(PanelDelivery::Both.supports_fetch());
    assert!(PanelDelivery::Push.supports_push());
    assert!(!PanelDelivery::Push.supports_fetch());
    assert!(PanelDelivery::Fetch.supports_fetch());
    assert!(!PanelDelivery::Fetch.supports_push());
    // 尚未实现数据面的面板: 既不推送也不拉取, 且显式区别于「仅拉取」
    assert!(!PanelDelivery::Unavailable.supports_push());
    assert!(!PanelDelivery::Unavailable.supports_fetch());
    assert!(!PanelDelivery::Unavailable.is_available());
    assert!(PanelDelivery::Fetch.is_available());
    assert_eq!(
        serde_json::to_value(PanelDelivery::Unavailable).unwrap(),
        serde_json::json!("unavailable")
    );
}

#[test]
fn binding_variants_use_camel_case_fields() {
    assert_eq!(
        serde_json::to_value(PanelBinding::EdgeBound {
            input_handles: vec!["value".to_string()],
        })
        .unwrap(),
        serde_json::json!({"kind": "edgeBound", "inputHandles": ["value"]})
    );
    assert_eq!(
        serde_json::to_value(PanelBinding::ConfigBound {
            config_key: "selectedInput".to_string(),
            port_template: "src:{source}:{handle}".to_string(),
        })
        .unwrap(),
        serde_json::json!({
            "kind": "configBound",
            "configKey": "selectedInput",
            "portTemplate": "src:{source}:{handle}",
        })
    );
    assert_eq!(
        serde_json::to_value(PanelBinding::Singleton).unwrap(),
        serde_json::json!({"kind": "singleton"})
    );
    assert_eq!(
        serde_json::to_value(PanelBinding::NodeScoped {
            node_id_param: "nodeId".to_string(),
        })
        .unwrap(),
        serde_json::json!({"kind": "nodeScoped", "nodeIdParam": "nodeId"})
    );
}

#[test]
fn descriptor_round_trips_and_skips_empty_collections() {
    let descriptor = descriptor();
    let wire = serde_json::to_value(&descriptor).unwrap();
    assert!(wire.get("outputs").is_none(), "empty ports are skipped");
    assert_eq!(wire["dataPlane"]["pushRequest"], "waveform");
    assert_eq!(wire["dataPlane"]["delivery"], "both");
    let back: PanelDescriptor = serde_json::from_value(wire).unwrap();
    assert_eq!(back, descriptor);
}

#[test]
fn panel_without_host_widget_omits_the_field() {
    let mut descriptor = descriptor();
    descriptor.kind = PanelKind::Can;
    descriptor.host_widget_kind = None;
    descriptor.default_params = Value::Null;
    let wire = serde_json::to_value(&descriptor).unwrap();
    assert!(wire.get("hostWidgetKind").is_none());
    assert!(wire.get("defaultParams").is_none());
}

#[test]
fn panel_operation_names_are_unique_within_each_namespace() {
    // push 与 fetch 是两个互不相通的面 (显示请求反序列化 vs 面板拉取分派),
    // 同一个载荷在两面共用一个拼写是允许的 (例如 spectrum) —
    // 唯一性只在各自命名空间内要求。
    let unique = |names: &[&str]| {
        let mut sorted = names.to_vec();
        let total = sorted.len();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), total, "duplicate name within one namespace");
    };
    unique(panel_ops::ALL_PUSH);
    unique(panel_ops::ALL_FETCH);
}

#[test]
fn push_names_are_snake_case_and_fetch_names_camel_case() {
    let is_snake = |name: &str| {
        !name.is_empty()
            && name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    };
    let is_camel = |name: &str| {
        let mut bytes = name.bytes();
        bytes.next().is_some_and(|b| b.is_ascii_lowercase())
            && bytes.all(|b| b.is_ascii_alphanumeric())
    };
    for name in panel_ops::ALL_PUSH {
        assert!(is_snake(name), "push name must be snake_case: {name}");
    }
    for name in panel_ops::ALL_FETCH {
        assert!(is_camel(name), "fetch name must be camelCase: {name}");
    }
}

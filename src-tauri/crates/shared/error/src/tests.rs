use super::*;

#[test]
fn app_error_display_uses_transport_message() {
    let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
    let e: AppError = TransportError::SerialOpen {
        port: "COM3".into(),
        source: io_err,
    }
    .into();
    let msg = e.to_string();
    assert!(msg.contains("COM3"));
    assert!(msg.contains("denied"));
}

#[test]
fn ai_app_error_kind_delegates_to_inner() {
    let e: AppError = AiError::MissingApiKey {
        adapter: "openai".into(),
    }
    .into();
    assert_eq!(e.kind(), "AiMissingApiKey");
    let e: AppError = McpError::Persist {
        source: std::io::Error::other("x"),
    }
    .into();
    assert_eq!(e.kind(), "McpPersist");
}

#[test]
fn app_error_kind_for_each_variant() {
    assert_eq!(
        AppError::Transport(TransportError::SerialClone(std::io::Error::other("x"))).kind(),
        "Transport"
    );
    assert_eq!(
        AppError::PortNotFound(PortNotFoundError { port: "x".into() }).kind(),
        "PortNotFound"
    );
    assert_eq!(
        AppError::PortAlreadyOpen(PortAlreadyOpenError { port: "x".into() }).kind(),
        "PortAlreadyOpen"
    );
    assert_eq!(
        AppError::PortNotOpen(PortNotOpenError { port: "x".into() }).kind(),
        "PortNotOpen"
    );
    let io_err = std::io::Error::other("x");
    assert_eq!(AppError::Io(io_err).kind(), "Io");
    assert_eq!(
        AppError::Serde(serde_json::from_str::<i32>("\"x\"").unwrap_err()).kind(),
        "Serde"
    );
}

/// 图版本冲突必须带独立稳定 kind (前端乐观并发重试据此分支, 不匹配文案),
/// 其余配置错误保持 "Config"。
#[test]
fn graph_version_conflict_has_dedicated_kind_and_current_field() {
    let conflict = AppError::Config(ConfigError::GraphVersionConflict { current: 9 });
    assert_eq!(conflict.kind(), "GraphVersionConflict");
    assert_eq!(
        conflict.data_fields().get("current").map(String::as_str),
        Some("9")
    );
    assert_eq!(
        AppError::Config(ConfigError::AutoBindingMissingProtocolNode).kind(),
        "Config"
    );
}

#[test]
fn app_error_status_codes() {
    let port_err = PortNotFoundError { port: "x".into() };
    assert_eq!(AppError::PortNotFound(port_err).status(), Some(404));
    let taken = PortAlreadyOpenError { port: "x".into() };
    assert_eq!(AppError::PortAlreadyOpen(taken).status(), Some(409));
    assert_eq!(AppError::Io(std::io::Error::other("x")).status(), Some(502));
    assert_eq!(
        AppError::Serde(serde_json::from_str::<i32>("\"x\"").unwrap_err()).status(),
        None
    );
}

#[test]
fn app_error_serializes_kind_message_source_data() {
    let io_err = std::io::Error::other("boom");
    let e: AppError = TransportError::SerialOpen {
        port: "COM3".into(),
        source: io_err,
    }
    .into();
    let v = serde_json::to_value(&e).expect("serialize");
    assert_eq!(v["kind"], "Transport");
    assert!(v["message"].as_str().unwrap().contains("COM3"));
    assert!(v["source"]["message"].as_str().unwrap().contains("boom"));
    assert_eq!(v["data"]["port"], "COM3");
}

#[test]
fn ai_error_data_fields_expose_structured_params() {
    let e: AppError = AiError::MissingApiKey {
        adapter: "orcarouter".into(),
    }
    .into();
    assert_eq!(
        e.data_fields().get("adapter").map(String::as_str),
        Some("orcarouter")
    );

    let e: AppError = AiError::ProviderRequest {
        adapter: "orcarouter".into(),
        model: "openai/gpt-4o-mini".into(),
        source: Box::new(std::io::Error::other("401")),
    }
    .into();
    let fields = e.data_fields();
    assert_eq!(
        fields.get("adapter").map(String::as_str),
        Some("orcarouter")
    );
    assert_eq!(
        fields.get("model").map(String::as_str),
        Some("openai/gpt-4o-mini")
    );

    let e: AppError = AiError::Keyring {
        details: "locked".into(),
    }
    .into();
    assert_eq!(e.kind(), "AiKeyring");

    let e: AppError = AiError::KeyringAccessDenied {
        details: "cancelled".into(),
    }
    .into();
    assert_eq!(e.kind(), "AiKeyringAccessDenied");
    let value = serde_json::to_value(&e).expect("serialize keyring access denied");
    assert_eq!(value["kind"], "AiKeyringAccessDenied");
    assert!(
        value["data"]
            .as_object()
            .is_some_and(serde_json::Map::is_empty)
    );
}

#[test]
fn boxed_error_roundtrip() {
    let e: AppError = TransportError::SerialClone(std::io::Error::other("x")).into();
    let boxed: Boxed = Box::new(TransportError::SerialClone(std::io::Error::other("y")));
    let other: AppError = AppError::Other(boxed);
    assert_eq!(other.kind(), "Other");
    assert!(other.to_string().contains('y'));
    assert_eq!(e.kind(), "Transport");
}

#[test]
fn plugin_error_kind() {
    let p = PluginError {
        plugin: "updater",
        source: Box::new(std::io::Error::other("net")),
    };
    let e: AppError = p.into();
    assert_eq!(e.kind(), "Plugin");
    assert!(e.to_string().contains("updater"));
}

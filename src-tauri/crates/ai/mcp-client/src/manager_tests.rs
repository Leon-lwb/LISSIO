use super::*;

/// 合法/非法配置校验。
#[test]
fn validate_config_checks_fields() {
    let stdio_ok = McpServerConfig {
        id: "a".to_string(),
        name: "A".to_string(),
        transport: McpTransport::Stdio {
            command: "uvx".to_string(),
            args: vec![],
            env: HashMap::default(),
        },
        enabled: true,
    };
    assert!(validate_config(&stdio_ok).is_ok());

    let http_bad = McpServerConfig {
        id: "b".to_string(),
        name: "B".to_string(),
        transport: McpTransport::Http {
            url: "ftp://nope".to_string(),
        },
        enabled: true,
    };
    assert!(validate_config(&http_bad).is_err());
}

/// 前缀安全段折叠。
#[test]
fn sanitize_segment_folds() {
    assert_eq!(sanitize_segment("My Server #1"), "my_server__1");
    assert_eq!(sanitize_segment("中文 server"), "server");
    assert_eq!(sanitize_segment("///"), "srv");
}

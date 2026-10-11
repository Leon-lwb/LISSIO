use super::*;
use crate::types::McpTransport;
use std::collections::HashMap;

#[test]
fn roundtrip_servers_file() {
    let dir = std::env::temp_dir().join(format!("vofa-mcp-test-{}", std::process::id()));
    let servers = vec![McpServerConfig {
        id: "s1".to_string(),
        name: "files".to_string(),
        transport: McpTransport::Stdio {
            command: "npx".to_string(),
            args: vec![
                "-y".to_string(),
                "@modelcontextprotocol/server-filesystem".to_string(),
            ],
            env: HashMap::default(),
        },
        enabled: true,
    }];

    save_servers(&dir, &servers).expect("保存配置");
    let loaded = load_servers(&dir).expect("读取配置");
    assert_eq!(loaded, servers);

    std::fs::remove_dir_all(&dir).ok();
}

/// 不存在的目录读取返回空列表 (首次启动零配置)。
#[test]
fn missing_file_is_empty() {
    let dir = std::env::temp_dir().join(format!("vofa-mcp-missing-{}", std::process::id()));
    let loaded = load_servers(&dir).expect("缺失文件应视为空");
    assert_eq!(loaded, []);
}

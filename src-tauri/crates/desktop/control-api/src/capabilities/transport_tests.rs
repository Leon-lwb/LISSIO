use super::*;

/// 节点声明完整性: 工具名与描述非空, 文档可读。
#[test]
fn node_declares_tools_and_docs() {
    let n = node();
    let names: Vec<_> = n.tools.iter().map(|t| t.name).collect();
    assert_eq!(
        names,
        vec![
            "list_devices",
            "list_serial_ports",
            "send_bytes",
            "send_string",
            "inject_bytes",
            "get_raw_data",
        ]
    );
    assert!(n.tools.iter().all(|t| !t.description.is_empty()));
    assert_eq!(n.skills.len(), 1);
    assert!(n.skills[0].md_zh.len() > 200);
}

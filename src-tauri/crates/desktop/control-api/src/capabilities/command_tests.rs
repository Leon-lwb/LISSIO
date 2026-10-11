use super::*;

/// 节点声明 2 个工具。
#[test]
fn node_declares_tools() {
    let n = node();
    let names: Vec<_> = n.tools.iter().map(|t| t.name).collect();
    assert_eq!(
        names,
        vec!["compute_command_frame_bytes", "send_command_frame"]
    );
}

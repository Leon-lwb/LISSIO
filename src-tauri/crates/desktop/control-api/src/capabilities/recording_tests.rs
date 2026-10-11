use super::*;

/// 节点声明 10 个工具。
#[test]
fn node_declares_tools() {
    let n = node();
    assert_eq!(n.tools.len(), 10);
    assert_eq!(n.tools[0].name, "list_recording_sessions");
    assert_eq!(n.tools[9].name, "export_recording_data");
}

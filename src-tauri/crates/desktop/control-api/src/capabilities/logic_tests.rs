use super::*;

/// 节点声明 1 个工具。
#[test]
fn node_declares_tools() {
    let n = node();
    assert_eq!(n.tools.len(), 1);
    assert_eq!(n.tools[0].name, "get_logic_data");
}

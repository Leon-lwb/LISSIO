use super::*;

/// 节点声明 8 个工具。
#[test]
fn node_declares_tools() {
    let n = node();
    let names: Vec<_> = n.tools.iter().map(|t| t.name).collect();
    assert_eq!(
        names,
        vec![
            "list_endpoints",
            "list_device_tree_nodes",
            "list_driver_manifests",
            "open_endpoint",
            "close_endpoint",
            "read_points",
            "write_points",
            "run_workspace",
        ]
    );
}

/// 动作枚举按 snake_case 反序列化。
#[test]
fn run_action_deserializes() {
    let params: RunWorkspaceParams =
        serde_json::from_value(serde_json::json!({"action": "pause"})).expect("合法动作");
    assert!(matches!(params.action, RunActionDto::Pause));
}

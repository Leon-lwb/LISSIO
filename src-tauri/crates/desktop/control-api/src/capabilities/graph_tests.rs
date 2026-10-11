use super::*;

/// 节点声明完整性。
#[test]
fn node_declares_tools_and_docs() {
    let n = node();
    let names: Vec<_> = n.tools.iter().map(|t| t.name).collect();
    assert_eq!(
        names,
        vec![
            "set_input_value",
            "get_graph_outputs",
            "list_tabs",
            "update_graph",
            "connect_edge",
            "disconnect_edge",
        ]
    );
    assert_eq!(n.skills.len(), 1);
    assert!(n.skills[0].md_en.len() > 200);
}

/// 连线参数含可选 tab/handle。
#[test]
fn connect_params_shape() {
    let schema = &n_tool_schema("connect_edge");
    assert_eq!(schema["required"], serde_json::json!(["source", "target"]));
    assert!(schema["properties"]["tab_id"].is_object());
}

fn n_tool_schema(name: &str) -> serde_json::Value {
    node()
        .tools
        .iter()
        .find(|t| t.name == name)
        .unwrap_or_else(|| panic!("缺少工具 {name}"))
        .input_schema
        .clone()
}

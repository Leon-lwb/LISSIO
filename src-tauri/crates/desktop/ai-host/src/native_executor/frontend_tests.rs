use super::*;

/// 前端工具规格完备: 名字集合与规格一一对应, 无重复。
#[test]
fn frontend_specs_cover_tool_names() {
    let specs = builtin_frontend_tool_specs();
    let mut seen = std::collections::HashSet::new();
    for t in &specs {
        assert!(seen.insert(t.name.as_str()), "重复工具名: {}", t.name);
        assert!(!t.description.is_empty());
        assert_eq!(t.input_schema["type"], "object");
    }
    assert_eq!(seen.len(), BUILTIN_FRONTEND_TOOLS.len());
    for name in BUILTIN_FRONTEND_TOOLS {
        assert!(seen.contains(name), "前端工具 {name} 未声明规格");
    }
    assert!(is_builtin_frontend_tool("add_node"));
    assert!(!is_builtin_frontend_tool("send_bytes"));
}

#[test]
fn web_tool_is_separate_from_builtin_tools() {
    assert_eq!(web_tool_specs().len(), WEB_TOOLS.len());
    assert!(is_web_tool("fetch_webpage"));
    assert!(!is_builtin_frontend_tool("fetch_webpage"));
}

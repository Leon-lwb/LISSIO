use super::*;

/// instructions 覆盖全部注册表节点与其工具名。
#[test]
fn instructions_cover_registry() {
    let registry = Arc::new(CapabilityRegistry::builtin());
    let text = compose_instructions(&registry);
    for node in registry.nodes() {
        assert!(text.contains(node.id), "instructions 缺少节点 {}", node.id);
        for t in &node.tools {
            assert!(text.contains(t.name), "instructions 缺少工具 {}", t.name);
        }
    }
}

use super::*;
use crate::capabilities::skill::Lang;
use crate::capabilities::tool::{ToolOutput, tool0};

/// 内置注册表: 覆盖全部已知工具与文档,名字唯一,数量只增不减。
#[test]
fn builtin_registry_complete() {
    let reg = CapabilityRegistry::builtin();
    let mut names: Vec<_> = reg.tools().map(|(_, t)| t.name).collect();
    names.sort_unstable();
    for expected in [
        "close_endpoint",
        "compute_command_frame_bytes",
        "connect_edge",
        "create_waveform_snapshot",
        "create_recording_session",
        "delete_recording_session",
        "disconnect_edge",
        "export_recording_data",
        "export_waveform_csv",
        "flush_recording",
        "get_buffer_info",
        "get_can_frames",
        "get_graph_outputs",
        "get_logic_data",
        "get_raw_data",
        "get_recent_waveform",
        "get_recording_health",
        "get_waveform_window",
        "inject_bytes",
        "list_data_sources",
        "list_device_tree_nodes",
        "list_devices",
        "list_driver_manifests",
        "list_endpoints",
        "list_recording_bindings",
        "list_recording_sessions",
        "list_serial_ports",
        "list_skills",
        "list_tabs",
        "open_endpoint",
        "query_recording_history",
        "query_recording_sql",
        "query_waveform_snapshot",
        "read_points",
        "read_skill",
        "release_waveform_snapshot",
        "run_workspace",
        "send_bytes",
        "send_can_frame",
        "send_command_frame",
        "send_string",
        "set_input_value",
        "switch_recording_session",
        "update_graph",
        "write_points",
    ] {
        assert!(names.contains(&expected), "缺少内置工具 {expected}");
    }
    assert!(
        names.len() >= 45,
        "内置工具应不少于 45 个, 实际 {}",
        names.len()
    );

    let skill_ids: Vec<_> = reg.skills().map(|(_, s)| s.id).collect();
    for expected in [
        "overview",
        "nodes-reference",
        "protocols",
        "debug-recipes",
        "tools-guide",
    ] {
        assert!(skill_ids.contains(&expected), "缺少技能文档 {expected}");
    }
}

/// 内置注册表: schema 为对象、描述非空、每个工具可按名定位。
#[test]
fn builtin_registry_shape() {
    let reg = CapabilityRegistry::builtin();
    for (node, t) in reg.tools() {
        assert!(
            t.input_schema.is_object(),
            "{}.{} schema 非对象",
            node.id,
            t.name
        );
        assert_eq!(
            t.input_schema["type"], "object",
            "{}.{} schema 缺 type",
            node.id, t.name
        );
        assert!(!t.description.is_empty(), "{}.{} 描述为空", node.id, t.name);
        let (owner, found) = reg.find_tool(t.name).expect("按名可查");
        assert_eq!(owner.id, node.id);
        assert_eq!(found.name, t.name);
    }
    assert!(!reg.nodes().is_empty());
    assert!(reg.nodes().iter().all(|n| !n.title(Lang::En).is_empty()));
}

fn node(
    id: &'static str,
    tool_names: &[&'static str],
    skill_ids: &[&'static str],
) -> CapabilityNode {
    CapabilityNode {
        id,
        title_zh: id,
        title_en: id,
        summary_zh: id,
        summary_en: id,
        tools: tool_names
            .iter()
            .map(|&n| {
                tool0(n, "测试工具", |_| async {
                    Ok(ToolOutput::Text(n.into()))
                })
            })
            .collect(),
        skills: skill_ids
            .iter()
            .map(|&sid| SkillDoc {
                id: sid,
                title_zh: sid,
                title_en: sid,
                summary_zh: sid,
                summary_en: sid,
                md_zh: "正文",
                md_en: "body",
            })
            .collect(),
    }
}

/// 查找:工具与 skill 命中所属节点,未知名返回 None。
#[test]
fn find_tool_and_skill() {
    let reg = CapabilityRegistry::new(vec![
        node("a", &["t1", "t2"], &["s1"]),
        node("b", &["t3"], &["s2"]),
    ])
    .expect("合法注册表");
    assert_eq!(reg.find_tool("t2").expect("命中").0.id, "a");
    assert_eq!(reg.find_tool("t3").expect("命中").0.id, "b");
    assert!(reg.find_tool("t9").is_none());
    assert_eq!(reg.find_skill("s2").expect("命中").id, "s2");
    assert!(reg.find_skill("s9").is_none());
    assert_eq!(reg.tools().count(), 3);
    assert_eq!(reg.skills().count(), 2);
    assert_eq!(reg.nodes()[1].title(Lang::En), "b");
}

/// 跨节点重复工具名拒绝装配。
#[test]
fn duplicate_tool_rejected() {
    let err = CapabilityRegistry::new(vec![node("a", &["dup"], &[]), node("b", &["dup"], &[])])
        .err()
        .expect("重复工具名");
    assert!(err.to_string().contains("dup"));
    assert!(matches!(err, RegistryError::DuplicateTool { .. }));
}

/// 跨节点重复 skill id 拒绝装配。
#[test]
fn duplicate_skill_rejected() {
    let err = CapabilityRegistry::new(vec![node("a", &["t"], &["dup"]), node("b", &[], &["dup"])])
        .err()
        .expect("重复 skill id");
    assert!(matches!(err, RegistryError::DuplicateSkill { .. }));
}

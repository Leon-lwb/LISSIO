use super::{CHANNEL, DESKTOP_ONLY, PAYLOAD_ARGS, PENDING, SUPPORTED};
use std::collections::HashSet;

/// 四个集合必须互不相交 — 否则能力矩阵自相矛盾。
#[test]
fn catalog_sets_are_disjoint() {
    let sets = [
        ("SUPPORTED", SUPPORTED),
        ("PENDING", PENDING),
        ("DESKTOP_ONLY", DESKTOP_ONLY),
        ("CHANNEL", CHANNEL),
    ];
    let mut seen: HashSet<&str> = HashSet::new();
    for (name, list) in sets {
        let unique: HashSet<&str> = list.iter().copied().collect();
        assert_eq!(unique.len(), list.len(), "{name} 含重复项");
        for cmd in list {
            assert!(seen.insert(cmd), "{name} 与其它集合重叠: {cmd}");
        }
    }
}

/// 通道类命令不得同时出现在可派发集合中。
#[test]
fn channel_commands_are_not_dispatchable() {
    for cmd in CHANNEL {
        assert!(!is_supported(cmd), "{cmd} 不应由 dispatch 承载");
        assert!(!PENDING.contains(cmd));
        assert!(!DESKTOP_ONLY.contains(cmd));
    }
}

/// 载荷型命令必须已接入出口 — 否则「跳过归一」保护的是永不执行的命令。
#[test]
fn payload_arg_commands_are_supported() {
    assert!(PAYLOAD_ARGS.len() == 2, "新增载荷型命令时必须同步登记");
    for cmd in PAYLOAD_ARGS {
        assert!(is_supported(cmd), "{cmd} 声明了载荷型参数但未接入 dispatch");
        assert!(
            !DESKTOP_ONLY.contains(cmd) && !CHANNEL.contains(cmd),
            "{cmd} 不可能同时是载荷型派发命令"
        );
    }
    assert!(args_are_a_payload("describe_node_documents"));
    assert!(args_are_a_payload("prepare_node_documents"));
    // 反例: 命名参数命令不得被误列入, 否则其 nodeId 不再归一
    assert!(!args_are_a_payload("send_raw"));
    assert!(!args_are_a_payload("update_tab_graph"));
}

use super::{args_are_a_payload, is_supported};

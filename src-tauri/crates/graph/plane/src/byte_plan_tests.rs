use super::*;
use graph_testkit::*;

#[test]
fn test_byte_plan_topo_order() {
    // transport.rx → protocol.in, protocol.out → decoder.in
    let g = TypedGraph::build(
        vec![
            make_device("tp"),
            make_protocol("pt"),
            make_decoder("dec", "t1"),
        ],
        vec![
            edge("tp-pt", "tp", "rx", "pt", "in"),
            edge("pt-dec", "pt", "out", "dec", "in"),
        ],
    )
    .unwrap();
    let plan = BytePlan::build(&g).expect("应编译成功");
    let pos = |id: &str| plan.order.iter().position(|n| n == id).unwrap();
    assert!(pos("tp") < pos("pt"), "transport 应先于 protocol");
    assert!(pos("pt") < pos("dec"), "protocol 应先于 decoder");

    // consumers 聚合
    let routes = plan.routes_for("tp");
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0].target, "pt");
    assert_eq!(routes[0].target_handle, "in");
    assert_eq!(plan.routes_for("pt").len(), 1);
    assert!(plan.routes_for("dec").is_empty());
}

#[test]
fn test_byte_plan_cycle_detected() {
    // protocol_a.out → protocol_b.in, protocol_b.out → protocol_a.in
    let g = TypedGraph::build(
        vec![make_protocol("pa"), make_protocol("pb")],
        vec![
            edge("pa-pb", "pa", "out", "pb", "in"),
            edge("pb-pa", "pb", "out", "pa", "in"),
        ],
    )
    .unwrap();
    let result = BytePlan::build(&g);
    match result {
        Err(CompileError::ByteCycle { cycle }) => {
            // 完整环路径: 首尾同节点, 两个协议节点都在环上
            assert_eq!(cycle.first(), cycle.last());
            assert!(cycle.contains(&"pa".to_string()));
            assert!(cycle.contains(&"pb".to_string()));
        }
        other => panic!("应报字节平面循环, 实际: {other:?}"),
    }
}

#[test]
fn test_byte_plan_includes_isolated_device() {
    // 无字节边的设备节点也应在字节平面内 (事件驱动 dispatch 的起点)
    let g = TypedGraph::build(vec![make_device("tp")], vec![]).unwrap();
    let plan = BytePlan::build(&g).expect("应编译成功");
    assert!(plan.contains("tp"));
    assert!(plan.routes_for("tp").is_empty());
}

#[test]
fn test_byte_plan_does_not_route_raw_data_marker() {
    let g = TypedGraph::build(
        vec![make_device("tp"), make_sink("raw", "t1")],
        vec![edge("raw-view", "tp", "rx", "raw", "src:tp:rx")],
    )
    .unwrap();
    let plan = BytePlan::build(&g).expect("RawData 观察边应正常编译");

    assert!(
        plan.routes_for("tp").is_empty(),
        "RawData 标记边由 collector 旁路订阅，不应进入字节路由"
    );
}

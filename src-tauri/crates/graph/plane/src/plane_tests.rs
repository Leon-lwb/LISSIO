use super::*;
use graph_testkit::*;
use kind::MathOp;

fn ids<'a>(g: &'a TypedGraph, order: &[NodeIndex]) -> Vec<&'a str> {
    order.iter().map(|&ix| g.id_of(ix)).collect()
}

#[test]
fn test_value_plane_topo_order() {
    // ps1 → m1, ps1 → s1(Str); Sink/Transport 不进值平面
    let g = TypedGraph::build(
        vec![
            make_protocol_source("ps1", "t1", "proto1", 1),
            make_math("m1", "t1", MathOp::Add, 1),
            make_sink("sink1", "t1"),
            make_device("tp"),
        ],
        vec![
            edge("e1", "ps1", "ch0", "m1", "in0"),
            edge("e2", "m1", "result", "sink1", "value"),
        ],
    )
    .unwrap();
    let mir = value_plane(&g).unwrap();
    let order = ids(&g, &mir.order);
    let pos = |id: &str| order.iter().position(|&n| n == id).unwrap();
    assert!(pos("ps1") < pos("m1"));
    assert!(!order.contains(&"sink1"));
    assert!(!order.contains(&"tp"));
    // 输入索引
    let (src, port) = &mir.input_index["m1"]["in0"];
    assert_eq!((src.as_str(), port.as_str()), ("ps1", "ch0"));
}

#[test]
fn test_value_plane_cycle_full_path() {
    let g = TypedGraph::build(
        vec![
            make_math("a", "t1", MathOp::Add, 1),
            make_math("b", "t1", MathOp::Add, 1),
        ],
        vec![
            edge("e1", "a", "result", "b", "in0"),
            edge("e2", "b", "result", "a", "in0"),
        ],
    )
    .unwrap();
    match value_plane(&g) {
        Err(CompileError::Cycle { cycle }) => {
            // 完整环路径: 首尾同节点, 两个节点都在环上
            assert_eq!(cycle.first(), cycle.last());
            assert!(cycle.contains(&"a".to_string()));
            assert!(cycle.contains(&"b".to_string()));
        }
        other => panic!("应报数值平面循环, 实际: {other:?}"),
    }
}

#[test]
fn test_cross_plane_no_false_cycle() {
    // FrameDecoder 输出 (F32) → Command 输入; Command.loopbackOut (Bytes)
    // → FrameDecoder.in (Bytes): 跨平面不构成循环
    let g = TypedGraph::build(
        vec![make_decoder("dec", "t1"), make_sink("cmd", "t1")],
        vec![
            edge("e1", "dec", "value", "cmd", "value"),
            edge("e2", "cmd", "loopbackOut", "dec", "in"),
        ],
    )
    .unwrap();
    assert!(value_plane(&g).is_ok());
    assert!(byte_plane_order(&g).is_ok());
}

#[test]
fn test_value_plane_rejects_ghost_endpoints() {
    let result = TypedGraph::build(
        vec![make_math("m1", "t1", MathOp::Add, 1)],
        vec![edge("e1", "ghost", "result", "m1", "in0")],
    );
    assert!(matches!(result, Err(CompileError::NodeNotFound { id }) if id == "ghost"));
}

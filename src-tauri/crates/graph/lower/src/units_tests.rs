use super::*;
use graph_testkit::{edge, make_input, make_math, make_protocol_source};
use kind::MathOp;

#[test]
fn independent_chains_split_into_distinct_units_supplies_do_not_merge() {
    // ps1 → m1 → m2; ps1 → m3 (ps1 供给喂两条独立链, 不合并 m1/m3)
    // input1 → m1 (m1/m3 仍独立 — input1 是供给)
    let g = TypedGraph::build(
        vec![
            make_protocol_source("ps1", "t1", "proto1", 1),
            make_input("input1", "t1"),
            make_math("m1", "t1", MathOp::Add, 1),
            make_math("m2", "t1", MathOp::Add, 1),
            make_math("m3", "t1", MathOp::Add, 1),
        ],
        vec![
            edge("e1", "ps1", "ch0", "m1", "in0"),
            edge("e2", "input1", "value", "m1", "in1"),
            edge("e3", "m1", "result", "m2", "in0"),
            edge("e4", "ps1", "ch0", "m3", "in0"),
        ],
    )
    .unwrap();
    let mir = plane::value_plane(&g).unwrap();
    let unit_of = partition(&g, &mir);
    // 供给 → prelude (0)
    for id in ["ps1", "input1"] {
        let pos = mir.order.iter().position(|&ix| g.id_of(ix) == id).unwrap();
        assert_eq!(unit_of[pos], 0, "{id} 应在 prelude");
    }
    // m1/m2 同链同单元; m3 独立单元
    let pos = |id: &str| mir.order.iter().position(|&ix| g.id_of(ix) == id).unwrap();
    assert_eq!(unit_of[pos("m1")], unit_of[pos("m2")], "链式节点应同单元");
    assert_ne!(unit_of[pos("m1")], unit_of[pos("m3")], "独立链应异单元");
    assert!(unit_of[pos("m1")] > 0 && unit_of[pos("m3")] > 0);
}

#[test]
fn graph_without_compute_nodes_is_entirely_prelude() {
    let g = TypedGraph::build(vec![make_input("input1", "t1")], vec![]).unwrap();
    let mir = plane::value_plane(&g).unwrap();
    let unit_of = partition(&g, &mir);
    assert!(unit_of.iter().all(|&u| u == 0));
}

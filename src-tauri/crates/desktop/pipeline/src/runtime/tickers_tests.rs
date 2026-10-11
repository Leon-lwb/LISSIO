use super::*;

fn str_map(entries: &[(&str, &str, &str)]) -> HashMap<String, HashMap<String, String>> {
    let mut m: HashMap<String, HashMap<String, String>> = HashMap::new();
    for &(node, port, value) in entries {
        m.entry(node.to_string())
            .or_default()
            .insert(port.to_string(), value.to_string());
    }
    m
}

fn edge(
    id: &str,
    source: &str,
    source_handle: &str,
    target: &str,
    target_handle: &str,
) -> buffer_graph::Edge {
    buffer_graph::Edge {
        id: id.to_string(),
        source: source.to_string(),
        source_handle: source_handle.to_string(),
        target: target.to_string(),
        target_handle: target_handle.to_string(),
    }
}

#[test]
#[allow(clippy::float_cmp)] // f32→f64 精确表示的整/半值, 无舍入
fn widget_inputs_resolve_from_source_graph_edges() {
    let graphs: crate::runtime::source_graph::SourceGraphs =
        std::sync::Arc::new(parking_lot::Mutex::new(HashMap::from([(
            "tab1".to_string(),
            crate::runtime::source_graph::TabSourceGraph {
                edges: vec![
                    edge("e1", "src1", "ch0", "cmd1", "in1"),
                    edge("e2", "src2", "value", "cmd1", "in2"),
                    edge("e3", "src3", "ch1", "cmd2", "in1"),
                ],
                ..Default::default()
            },
        )])));
    let mut outputs: graph::ValuesMap = HashMap::default();
    outputs.insert(
        "src1".to_string(),
        rustc_hash::FxHashMap::from_iter([("ch0".to_string(), 1.5_f32)]),
    );
    outputs.insert(
        "src2".to_string(),
        rustc_hash::FxHashMap::from_iter([("value".to_string(), -2.0_f32)]),
    );
    outputs.insert(
        "src3".to_string(),
        rustc_hash::FxHashMap::from_iter([("ch1".to_string(), 7.0_f32)]),
    );

    let inputs = resolve_widget_inputs(&graphs, &outputs, "cmd1");
    // 命中上游发布值
    assert_eq!(inputs["in1"], 1.5);
    // 无 handle 的上游输出按 "value" 端口解析 (与前端 numericPortRef 一致)
    assert_eq!(inputs["in2"], -2.0);
    // 其他 widget 的边不混入
    assert!(!inputs.contains_key("missing"));
    assert_eq!(inputs.len(), 2);
    assert_ne!(inputs.get("in1"), Some(&7.0));

    // 缺失上游发布值回退 0 (与前端 `?? 0` 一致)
    let empty: graph::ValuesMap = HashMap::default();
    let fallback = resolve_widget_inputs(&graphs, &empty, "cmd1");
    assert_eq!(fallback["in1"], 0.0);
}

#[test]
fn merge_prefers_graph_on_same_key() {
    let custom = str_map(&[("w1", "text", "custom"), ("w1", "extra", "keep")]);
    let graph = str_map(&[("w1", "text", "graph")]);
    let merged = merge_string_outputs(&custom, &graph);
    // 同 (widget, port) 键: 后端求值覆盖前端提交
    assert_eq!(merged["w1"]["text"], "graph");
    // 同 widget 不同 port: 并存 (深合并, 非整节点覆盖)
    assert_eq!(merged["w1"]["extra"], "keep");
}

#[test]
fn merge_keeps_disjoint_entries() {
    let custom = str_map(&[("trig1", "text", "hit")]);
    let graph = str_map(&[("str1", "result", "ABC")]);
    let merged = merge_string_outputs(&custom, &graph);
    assert_eq!(merged["trig1"]["text"], "hit");
    assert_eq!(merged["str1"]["result"], "ABC");
}

#[test]
fn merge_handles_empty_sides() {
    let custom = str_map(&[("trig1", "text", "hit")]);
    assert_eq!(merge_string_outputs(&custom, &HashMap::new()), custom);
    let graph = str_map(&[("str1", "result", "ABC")]);
    assert_eq!(merge_string_outputs(&HashMap::new(), &graph), graph);
}

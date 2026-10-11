use super::*;

#[test]
fn custom_inputs_collection_keeps_latest_value_contract() {
    let state = AppState::new();
    state.data_plane.eval.output_snapshot.lock().values.insert(
        "source".into(),
        std::iter::once(("out".into(), 42.0)).collect(),
    );

    let batch = collect_custom_inputs(&state.data_plane.eval);

    assert!(batch.inputs.is_empty(), "没有 Custom 节点时不应伪造输入");
    assert!(
        state.data_plane.eval.output_snapshot.try_lock().is_some(),
        "采集结束后不得遗留 output_snapshot 锁"
    );
    assert!(
        state.data_plane.eval.graphs.try_lock().is_some(),
        "采集结束后不得遗留 graphs 锁"
    );
}

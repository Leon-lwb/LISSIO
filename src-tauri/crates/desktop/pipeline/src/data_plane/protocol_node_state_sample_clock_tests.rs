use super::{ProtocolNodeState, SampleClockBasis};

fn just_float_schema() -> schema_types::ProtocolSchema {
    let config = ProtocolConfig::JustFloat { channels: Some(1) };
    schema_types::schema_from_protocol_config(&config)
}

use data_model::DataFrame;
use schema_types::ProtocolConfig;

#[test]
fn preset_uses_node_config_when_schema_has_no_preset_config() {
    let schema = schema_types::ProtocolSchema {
        preset: schema_types::SchemaPreset::Slcan,
        preset_config: None,
        decode: Vec::new(),
        encode: None,
    };
    let state = ProtocolNodeState::new(&ProtocolConfig::Slcan, None, &schema);
    assert_eq!(state.engine.lock().name(), "Slcan");
}

fn frames(count: usize) -> Vec<DataFrame> {
    (0..count)
        .map(|_| DataFrame::with_timestamp(0, vec![1.0]))
        .collect()
}

#[test]
fn exact_clock_preserves_an_explicit_lagged_gap() {
    let mut state = ProtocolNodeState::new(
        &ProtocolConfig::JustFloat { channels: Some(1) },
        None,
        &just_float_schema(),
    );
    let hint = Some((SampleClockBasis::ExactRate, 1_000.0, 0));
    let mut first = frames(2);
    state.restamp_frames(hint, 10_000, &mut first);
    assert_eq!(
        first
            .iter()
            .map(|frame| frame.timestamp)
            .collect::<Vec<_>>(),
        vec![9_000, 10_000]
    );

    // 三帧在解析前丢失；下一帧与上一帧应相隔四个采样周期。
    state.note_exact_frame_gap(3, 1_000.0);
    let mut second = frames(2);
    state.restamp_frames(hint, 99_000, &mut second);
    assert_eq!(
        second
            .iter()
            .map(|frame| frame.timestamp)
            .collect::<Vec<_>>(),
        vec![14_000, 15_000]
    );
}

#[test]
fn gap_before_first_visible_batch_is_absorbed_by_arrival_anchor() {
    let mut state = ProtocolNodeState::new(
        &ProtocolConfig::JustFloat { channels: Some(1) },
        None,
        &just_float_schema(),
    );
    state.note_exact_frame_gap(500, 1_000.0);
    let mut first = frames(2);
    state.restamp_frames(
        Some((SampleClockBasis::ExactRate, 1_000.0, 0)),
        10_000,
        &mut first,
    );
    assert_eq!(first[1].timestamp, 10_000);
}

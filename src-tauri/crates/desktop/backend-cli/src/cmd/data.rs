//! 数据读取与波形快照 — data / snapshot 命令。

use control_api::Toolbox;
use control_api::data;
use control_api::tools;
use serde_json::{Value, json};

use super::{DataAction, SnapshotAction};

/// 数据读取命令分发。
pub fn data(tb: &Toolbox, action: &DataAction) -> Result<Value, String> {
    match action {
        DataAction::Sources => Ok(tools::list_data_sources(tb)),
        DataAction::Waveform { source, count } => tools::get_recent_waveform(tb, source, *count),
        DataAction::Window {
            source,
            start_ms,
            end_ms,
        } => tools::get_waveform_window(tb, source, *start_ms, *end_ms),
        DataAction::Buffer { source } => Ok(tools::get_buffer_info(tb, source)),
        DataAction::Can { count, bitrate } => Ok(tools::get_can_frames(tb, *count, *bitrate)),
        DataAction::Logic { count } => Ok(tools::get_logic_data(tb, *count)),
        DataAction::Raw { source, max_bytes } => Ok(tools::get_raw_data(tb, source, *max_bytes)),
    }
}

/// 波形停止快照命令分发。
pub async fn snapshot(tb: &Toolbox, action: &SnapshotAction) -> Result<Value, String> {
    match action {
        SnapshotAction::Create { source } => data::create_waveform_snapshot(tb, source)
            .await
            .and_then(|created| serde_json::to_value(created).map_err(|e| e.to_string())),
        SnapshotAction::Query {
            snapshot_id,
            start_ms,
            end_ms,
            max_points,
        } => data::query_waveform_snapshot(
            tb,
            snapshot_id,
            *start_ms,
            *end_ms,
            *max_points as usize,
            waveform::WaveformSeriesSelection::default(),
        )
        .await
        .and_then(|window| serde_json::to_value(window).map_err(|e| e.to_string())),
        SnapshotAction::Release { snapshot_id } => {
            data::release_waveform_snapshot(tb, snapshot_id);
            Ok(json!({ "ok": true }))
        }
        SnapshotAction::ExportCsv {
            source,
            snapshot_id,
            start_timestamp_us,
            end_timestamp_us,
            path,
        } => data::export_waveform_csv(
            tb,
            source,
            snapshot_id.clone(),
            *start_timestamp_us,
            *end_timestamp_us,
            waveform::WaveformSeriesSelection::default(),
            path.clone(),
        )
        .await
        .map(|rows| json!({ "rows": rows })),
    }
}

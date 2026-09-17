//! 录制 — 会话生命周期 / 历史 / SQL / 导出 (全部委托 control-api::recording)。

use control_api::Toolbox;
use control_api::recording;
use serde_json::{Value, json};

use super::RecordAction;

/// 录制命令分发。
pub async fn record(tb: &Toolbox, action: &RecordAction) -> Result<Value, String> {
    match action {
        RecordAction::List => recording::list_sessions(tb)
            .await
            .and_then(|sessions| serde_json::to_value(sessions).map_err(|e| e.to_string())),
        RecordAction::Bindings { session_id } => recording::list_bindings(tb, session_id)
            .await
            .and_then(|bindings| serde_json::to_value(bindings).map_err(|e| e.to_string())),
        RecordAction::Create => recording::create_session(tb)
            .await
            .and_then(|session| serde_json::to_value(session).map_err(|e| e.to_string())),
        RecordAction::Switch { session_id } => recording::switch_session(tb, session_id)
            .await
            .and_then(|session| serde_json::to_value(session).map_err(|e| e.to_string())),
        RecordAction::Delete { session_id } => {
            recording::delete_session(tb, session_id).await?;
            Ok(json!({ "ok": true }))
        }
        RecordAction::History {
            session_id,
            binding_id,
            after_row_id,
            from_us,
            to_us,
            limit,
            include_payload,
        } => recording::history_page(
            tb,
            recording::HistoryQuery {
                session_id: session_id.clone(),
                binding_id: binding_id.clone(),
                after_row_id: after_row_id.unwrap_or_default(),
                from_us: *from_us,
                to_us: *to_us,
                limit: limit.unwrap_or(500),
                include_payload: *include_payload,
            },
        )
        .await
        .and_then(|page| serde_json::to_value(page).map_err(|e| e.to_string())),
        RecordAction::Sql { sql, max_rows } => {
            let query_id = format!(
                "cli-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |d| d.as_nanos())
            );
            recording::query_sql(tb, &query_id, sql, max_rows.unwrap_or(10_000))
                .await
                .and_then(|result| serde_json::to_value(result).map_err(|e| e.to_string()))
        }
        RecordAction::Health => {
            serde_json::to_value(recording::health(tb)).map_err(|e| e.to_string())
        }
        RecordAction::Flush => {
            recording::flush(tb).await?;
            Ok(json!({ "ok": true }))
        }
        RecordAction::Export { request_file } => {
            let value = crate::read_json_file(request_file)?;
            let request: recording::RecordingExportRequest = serde_json::from_value(value)
                .map_err(|error| format!("RecordingExportRequest JSON 不符: {error}"))?;
            recording::export_data(tb, request)
                .await
                .and_then(|result| serde_json::to_value(result).map_err(|e| e.to_string()))
        }
    }
}

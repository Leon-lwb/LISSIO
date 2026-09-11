use std::fs::File;
use std::io::{BufWriter, Write};

use duckdb::{Connection, params};
use serde::Serialize;

use crate::{
    BatchPayload, HistoryQuery, RecordingError, RecordingExportFormat, RecordingExportRequest,
    RecordingExportResult, RecordingStore, StoredBatch,
};

#[derive(Debug, Serialize)]
struct ExportRow {
    session_id: String,
    binding_id: String,
    domain: String,
    row_id: i64,
    sequence: u64,
    first_timestamp_us: u64,
    last_timestamp_us: u64,
    index: u64,
    value: Option<f64>,
    text: Option<String>,
    frequency: Option<f64>,
}

pub fn export_recording_data(
    store: &RecordingStore,
    request: &RecordingExportRequest,
) -> Result<RecordingExportResult, RecordingError> {
    if request.path.trim().is_empty() {
        return Err(RecordingError::Invalid("export path is empty".into()));
    }
    let file = File::create(&request.path)?;
    let result = match request.format {
        RecordingExportFormat::Csv => write_csv(store, request, file),
        RecordingExportFormat::Json => write_json(store, request, file),
        RecordingExportFormat::Parquet => write_parquet(store, request),
    }?;
    Ok(result)
}

fn for_each_export_row<F>(
    store: &RecordingStore,
    request: &RecordingExportRequest,
    mut emit: F,
) -> Result<u64, RecordingError>
where
    F: FnMut(ExportRow) -> Result<(), RecordingError>,
{
    let mut after_row_id = 0_i64;
    let mut count = 0_u64;
    loop {
        let page = store.history_page_query(&HistoryQuery {
            session_id: request.session_id.clone(),
            binding_id: request.binding_id.clone(),
            after_row_id,
            from_us: request.from_us,
            to_us: request.to_us,
            limit: 1_000,
            include_payload: true,
        })?;
        if page.rows.is_empty() {
            break;
        }
        for batch in &page.rows {
            for row in rows_for_batch(batch) {
                emit(row)?;
                count = count.saturating_add(1);
            }
        }
        match page.next_row_id {
            Some(next) if next > after_row_id => after_row_id = next,
            _ => break,
        }
    }
    Ok(count)
}

fn rows_for_batch(batch: &StoredBatch) -> Vec<ExportRow> {
    let Some(payload) = batch.payload.as_ref() else {
        return Vec::new();
    };
    match payload {
        BatchPayload::Bytes { data } => Vec::from([ExportRow {
            session_id: batch.session_id.clone(),
            binding_id: batch.binding_id.clone(),
            domain: "bytes".into(),
            row_id: batch.row_id,
            sequence: batch.sequence_start,
            first_timestamp_us: batch.first_timestamp_us,
            last_timestamp_us: batch.last_timestamp_us,
            index: 0,
            value: None,
            text: Some(encode_hex(data)),
            frequency: None,
        }]),
        BatchPayload::String { values } => values
            .iter()
            .enumerate()
            .map(|(index, value)| ExportRow {
                session_id: batch.session_id.clone(),
                binding_id: batch.binding_id.clone(),
                domain: "string".into(),
                row_id: batch.row_id,
                sequence: batch.sequence_start + index as u64,
                first_timestamp_us: batch.first_timestamp_us,
                last_timestamp_us: batch.last_timestamp_us,
                index: index as u64,
                value: None,
                text: Some(value.clone()),
                frequency: None,
            })
            .collect(),
        BatchPayload::Float { values } => values
            .iter()
            .enumerate()
            .map(|(index, value)| ExportRow {
                session_id: batch.session_id.clone(),
                binding_id: batch.binding_id.clone(),
                domain: "float".into(),
                row_id: batch.row_id,
                sequence: batch.sequence_start + index as u64,
                first_timestamp_us: batch.first_timestamp_us,
                last_timestamp_us: batch.last_timestamp_us,
                index: index as u64,
                value: Some(*value),
                text: None,
                frequency: None,
            })
            .collect(),
        BatchPayload::Spectrum {
            frequencies,
            values,
        } => frequencies
            .iter()
            .zip(values.iter())
            .enumerate()
            .map(|(index, (frequency, value))| ExportRow {
                session_id: batch.session_id.clone(),
                binding_id: batch.binding_id.clone(),
                domain: "spectrum".into(),
                row_id: batch.row_id,
                sequence: batch.sequence_start + index as u64,
                first_timestamp_us: batch.first_timestamp_us,
                last_timestamp_us: batch.last_timestamp_us,
                index: index as u64,
                value: Some(*value),
                text: None,
                frequency: Some(*frequency),
            })
            .collect(),
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len().saturating_mul(2));
    for byte in bytes {
        out.push(HEX[usize::from(byte >> 4)] as char);
        out.push(HEX[usize::from(byte & 0x0f)] as char);
    }
    out
}

fn write_csv(
    store: &RecordingStore,
    request: &RecordingExportRequest,
    file: File,
) -> Result<RecordingExportResult, RecordingError> {
    let mut writer = BufWriter::new(file);
    write_csv_header(&mut writer)?;
    let rows = for_each_export_row(store, request, |row| write_csv_row(&mut writer, row))?;
    writer.flush()?;
    let bytes = writer.get_ref().metadata()?.len();
    Ok(RecordingExportResult { rows, bytes })
}

fn write_csv_header(writer: &mut impl Write) -> Result<(), RecordingError> {
    writeln!(
        writer,
        "session_id,binding_id,domain,row_id,sequence,first_timestamp_us,last_timestamp_us,index,value,text,frequency",
    )?;
    Ok(())
}

fn write_csv_row(writer: &mut impl Write, row: ExportRow) -> Result<(), RecordingError> {
    let fields = Vec::from([
        csv_field(&row.session_id),
        csv_field(&row.binding_id),
        row.domain,
        row.row_id.to_string(),
        row.sequence.to_string(),
        row.first_timestamp_us.to_string(),
        row.last_timestamp_us.to_string(),
        row.index.to_string(),
        row.value
            .map_or_else(String::new, |value| value.to_string()),
        csv_field(&row.text.unwrap_or_default()),
        row.frequency
            .map_or_else(String::new, |frequency| frequency.to_string()),
    ]);
    writeln!(writer, "{}", fields.join(","))?;
    Ok(())
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn write_json(
    store: &RecordingStore,
    request: &RecordingExportRequest,
    file: File,
) -> Result<RecordingExportResult, RecordingError> {
    let mut writer = BufWriter::new(file);
    writer.write_all(b"[")?;
    let mut first = true;
    let rows = for_each_export_row(store, request, |row| {
        if first {
            first = false;
        } else {
            writer.write_all(b",")?;
        }
        serde_json::to_writer(&mut writer, &row)
            .map_err(|error| RecordingError::Invalid(error.to_string()))?;
        Ok(())
    })?;
    writer.write_all(b"]")?;
    writer.flush()?;
    let bytes = writer.get_ref().metadata()?.len();
    Ok(RecordingExportResult { rows, bytes })
}

fn write_parquet(
    store: &RecordingStore,
    request: &RecordingExportRequest,
) -> Result<RecordingExportResult, RecordingError> {
    let connection = Connection::open_in_memory()?;
    connection.execute_batch(
        "CREATE TABLE export_rows( \
            session_id VARCHAR, binding_id VARCHAR, domain VARCHAR, row_id BIGINT, \
            sequence UBIGINT, first_timestamp_us UBIGINT, last_timestamp_us UBIGINT, \
            index UBIGINT, value DOUBLE, text VARCHAR, frequency DOUBLE);",
    )?;
    let rows = {
        let mut appender = connection.appender("export_rows")?;
        for_each_export_row(store, request, |row| {
            appender
                .append_row(params![
                    row.session_id,
                    row.binding_id,
                    row.domain,
                    row.row_id,
                    row.sequence,
                    row.first_timestamp_us,
                    row.last_timestamp_us,
                    row.index,
                    row.value,
                    row.text,
                    row.frequency,
                ])
                .map_err(RecordingError::from)?;
            Ok(())
        })?
    };
    let escaped_path = request.path.replace('\'', "''");
    let copy_sql = format!("COPY (SELECT * FROM export_rows) TO '{escaped_path}' (FORMAT PARQUET)");
    connection.execute_batch(&copy_sql)?;
    let bytes = std::fs::metadata(&request.path)?.len();
    Ok(RecordingExportResult { rows, bytes })
}

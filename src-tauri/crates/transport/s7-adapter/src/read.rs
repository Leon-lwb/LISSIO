use crate::client::{
    OperationError, Runtime, ensure_connected, mark_degraded, mark_online, normalize,
};
use crate::planner::ReadPlan;
use crate::{S7Point, decode_point, plan_reads};
use acquisition::config::reconnect_delay;
use acquisition::{AcquisitionError, AcquisitionResult};
use flow::{Direction, FlowEnvelope};
use points::{
    DeliveryClass, PointBatch, PointId, PointQuality, PointSample, PointValue, ReadResult,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio_s7::item::RequestItem;
use tokio_s7::types::{S7ParamVariableType, S7ReturnCode, SyntaxID};

pub async fn read_points(
    runtime: &Arc<Runtime>,
    requested: &[PointId],
) -> AcquisitionResult<ReadResult> {
    let selected: Vec<&S7Point> = requested
        .iter()
        .map(|id| {
            runtime
                .points
                .get(id)
                .ok_or_else(|| AcquisitionError::InvalidConfig(format!("unknown point: {}", id.0)))
        })
        .collect::<AcquisitionResult<_>>()?;
    let budget = runtime.max_read_bytes.load(Ordering::Acquire);
    let plans = plan_reads(selected.iter().copied(), budget)
        .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))?;
    let mut samples = Vec::with_capacity(selected.len());
    for plan in plans {
        match read_window(runtime, &plan).await {
            Ok(bytes) => {
                for planned in plan.points {
                    let point = runtime
                        .points
                        .get(&planned.point_id)
                        .expect("validated read plan");
                    let window = bytes
                        .get(usize::try_from(planned.offset).unwrap_or(usize::MAX)..)
                        .unwrap_or_default();
                    match decode_point(point, window) {
                        Ok(value) => {
                            samples.push(sample(runtime, point, Some(value), PointQuality::GOOD));
                        }
                        Err(error) => samples.push(sample(
                            runtime,
                            point,
                            None,
                            error_quality(OperationError::new("decode", &error.to_string(), false)),
                        )),
                    }
                }
            }
            Err(error) => {
                for planned in plan.points {
                    let point = runtime
                        .points
                        .get(&planned.point_id)
                        .expect("validated read plan");
                    samples.push(sample(runtime, point, None, error_quality(error.clone())));
                }
            }
        }
    }
    let by_id: HashMap<_, _> = samples
        .into_iter()
        .map(|sample| (sample.key.point_id.clone(), sample))
        .collect();
    let samples = requested
        .iter()
        .filter_map(|point_id| by_id.get(point_id).cloned())
        .collect();
    let sequence = runtime.sequence.fetch_add(1, Ordering::Relaxed);
    Ok(ReadResult {
        batch: FlowEnvelope {
            source_id: runtime.source_id.clone(),
            connection_epoch: runtime.connection_epoch.load(Ordering::Acquire),
            first_sequence: sequence,
            last_sequence: sequence,
            observed_time_unix_ns: data_model::now_ns(),
            direction: Direction::Receive,
            gap_before: None,
            payload: PointBatch {
                delivery: DeliveryClass::State,
                samples,
            },
        },
    })
}

/// Byte-transport read item: `count` bytes at a byte address inside `area`.
///
/// Booleans decode their bit client-side, which keeps merging simple and
/// avoids BIT transport quirks on the read path.
pub const fn byte_read_item(plan: &ReadPlan) -> RequestItem {
    RequestItem {
        specification_type: 0x12,
        length_of_following: 0x0A,
        syntax_id: SyntaxID::S7Any,
        variable_type: S7ParamVariableType::Byte,
        count: plan.byte_count,
        db_number: plan.db_number,
        area: plan.area.to_sdk(),
        byte_address: plan.start,
        bit_address: 0,
    }
}

async fn read_window(runtime: &Arc<Runtime>, plan: &ReadPlan) -> Result<Vec<u8>, OperationError> {
    let mut attempt = 0_u32;
    loop {
        ensure_connected(runtime)
            .await
            .map_err(|error| OperationError::new("connect", &error.to_string(), true))?;
        let timeout = Duration::from_millis(runtime.config.timeout_ms);
        let result = {
            let guard = runtime.client.lock().await;
            let client = guard
                .as_ref()
                .ok_or_else(|| OperationError::new("closed", "connection unavailable", true))?;
            let mut closed = runtime.closed.subscribe();
            tokio::select! {
                _ = closed.changed() => {
                    return Err(OperationError::new("cancelled", "S7 request cancelled", true));
                }
                result = tokio::time::timeout(timeout, client.read(vec![byte_read_item(plan)])) => {
                    result
                }
            }
        };
        match normalize(result) {
            Ok(data_items) => {
                mark_online(runtime);
                return extract_window(plan, data_items);
            }
            Err(error) if !error.disconnect => {
                mark_online(runtime);
                return Err(error);
            }
            Err(error) => {
                mark_degraded(runtime, &error.detail);
                runtime.client.lock().await.take();
                if attempt >= runtime.config.reconnect.max_attempts {
                    return Err(error);
                }
                attempt = attempt.saturating_add(1);
                *runtime.state.write() = acquisition::SourceState::Backoff { attempt };
                let mut closed = runtime.closed.subscribe();
                tokio::select! {
                    () = tokio::time::sleep(reconnect_delay(
                        &runtime.config.reconnect,
                        attempt,
                    )) => {}
                    _ = closed.changed() => {
                        return Err(OperationError::new("cancelled", "S7 request cancelled", true));
                    }
                }
            }
        }
    }
}

fn extract_window(
    plan: &ReadPlan,
    mut items: Vec<tokio_s7::item::DataItem>,
) -> Result<Vec<u8>, OperationError> {
    let item = items.pop().ok_or_else(|| {
        OperationError::new("emptyResponse", "S7 read returned no data item", true)
    })?;
    if item.return_code != S7ReturnCode::Success {
        return Err(OperationError::new(
            &format!("returnCode:0x{:02X}", item.return_code.code()),
            item.return_code.description(),
            false,
        ));
    }
    if item.data.len() != usize::from(plan.byte_count) {
        return Err(OperationError::new(
            "lengthMismatch",
            &format!(
                "expected {} bytes for the read window, got {}",
                plan.byte_count,
                item.data.len()
            ),
            false,
        ));
    }
    Ok(item.data)
}

fn sample(
    runtime: &Runtime,
    point: &S7Point,
    value: Option<PointValue>,
    quality: PointQuality,
) -> PointSample {
    PointSample {
        key: points::PointKey {
            source_id: runtime.source_id.clone(),
            point_id: point.id.clone(),
        },
        value,
        quality,
        source_time_unix_ns: None,
        server_time_unix_ns: None,
        received_time_unix_ns: data_model::now_ns(),
    }
}

pub fn error_quality(error: OperationError) -> PointQuality {
    acquisition::operation::error_quality(error, "s7")
}

#[cfg(test)]
#[path = "read_tests.rs"]
mod tests;

use crate::client::{
    OperationError, Runtime, ensure_connected, mark_degraded, mark_online, normalize,
};
use crate::{ModbusArea, ModbusPoint, decode_registers, plan_reads};
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
use tokio_modbus::client::Reader;

pub async fn read_points(
    runtime: &Arc<Runtime>,
    requested: &[PointId],
) -> AcquisitionResult<ReadResult> {
    let selected: Vec<&ModbusPoint> = requested
        .iter()
        .map(|id| {
            runtime
                .points
                .get(id)
                .ok_or_else(|| AcquisitionError::InvalidConfig(format!("unknown point: {}", id.0)))
        })
        .collect::<AcquisitionResult<_>>()?;
    let plans = plan_reads(selected.iter().copied())
        .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))?;
    let mut samples = Vec::with_capacity(selected.len());
    for plan in plans {
        match read_plan(runtime, plan.area, plan.start, plan.quantity).await {
            Ok(ReadPayload::Bits(values)) => {
                for planned in plan.points {
                    let point = runtime
                        .points
                        .get(&planned.point_id)
                        .expect("validated read plan");
                    let value = values
                        .get(usize::from(planned.offset))
                        .copied()
                        .map(PointValue::Bool);
                    samples.push(sample(runtime, point, value, PointQuality::GOOD));
                }
            }
            Ok(ReadPayload::Registers(values)) => {
                for planned in plan.points {
                    let point = runtime
                        .points
                        .get(&planned.point_id)
                        .expect("validated read plan");
                    let registers = values
                        .get(usize::from(planned.offset)..)
                        .unwrap_or_default();
                    match decode_registers(point, registers) {
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

enum ReadPayload {
    Bits(Vec<bool>),
    Registers(Vec<u16>),
}

async fn read_plan(
    runtime: &Arc<Runtime>,
    area: ModbusArea,
    start: u16,
    quantity: u16,
) -> Result<ReadPayload, OperationError> {
    let mut attempt = 0_u32;
    loop {
        ensure_connected(runtime)
            .await
            .map_err(|error| OperationError::new("connect", &error.to_string(), true))?;
        let timeout = Duration::from_millis(runtime.config.timeout_ms());
        let result = {
            let mut guard = runtime.context.lock().await;
            let context = guard
                .as_mut()
                .ok_or_else(|| OperationError::new("closed", "connection unavailable", true))?;
            let mut closed = runtime.closed.subscribe();
            tokio::select! {
                _ = closed.changed() => return Err(OperationError::new("cancelled", "Modbus request cancelled", true)),
                result = tokio::time::timeout(timeout, async {
                    match area {
                        ModbusArea::Coils => context
                            .read_coils(start, quantity)
                            .await
                            .map(|inner| inner.map(ReadPayload::Bits)),
                        ModbusArea::DiscreteInputs => context
                            .read_discrete_inputs(start, quantity)
                            .await
                            .map(|inner| inner.map(ReadPayload::Bits)),
                        ModbusArea::InputRegisters => context
                            .read_input_registers(start, quantity)
                            .await
                            .map(|inner| inner.map(ReadPayload::Registers)),
                        ModbusArea::HoldingRegisters => context
                            .read_holding_registers(start, quantity)
                            .await
                            .map(|inner| inner.map(ReadPayload::Registers)),
                    }
                }) => result,
            }
        };
        match normalize(result) {
            Ok(value) => {
                mark_online(runtime);
                return Ok(value);
            }
            Err(error) if !error.disconnect => {
                mark_online(runtime);
                return Err(error);
            }
            Err(error) => {
                mark_degraded(runtime, &error.detail);
                runtime.context.lock().await.take();
                if attempt >= runtime.config.reconnect().max_attempts {
                    return Err(error);
                }
                attempt = attempt.saturating_add(1);
                *runtime.state.write() = acquisition::SourceState::Backoff { attempt };
                let mut closed = runtime.closed.subscribe();
                tokio::select! {
                    () = tokio::time::sleep(reconnect_delay(runtime.config.reconnect(), attempt)) => {}
                    _ = closed.changed() => return Err(OperationError::new("cancelled", "Modbus request cancelled", true)),
                }
            }
        }
    }
}

fn sample(
    runtime: &Runtime,
    point: &ModbusPoint,
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
    acquisition::operation::error_quality(error, "modbus")
}

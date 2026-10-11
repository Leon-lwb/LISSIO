use crate::client::{
    OperationError, Runtime, ensure_connected, mark_degraded, mark_online, normalize,
};
use crate::{ModbusArea, ModbusPoint, encode_registers};
use acquisition::{AcquisitionError, AcquisitionResult};
use points::{PointQuality, PointValue, WriteItemResult, WriteRequest, WriteResult};
use std::sync::Arc;
use std::time::Duration;
use tokio_modbus::client::Writer;

pub async fn write_request(
    runtime: &Arc<Runtime>,
    request: WriteRequest,
) -> AcquisitionResult<WriteResult> {
    if request.deadline_unix_ns <= data_model::now_ns() {
        return Err(AcquisitionError::Timeout);
    }
    let mut results = Vec::with_capacity(request.items.len());
    for item in request.items {
        let quality = match runtime.points.get(&item.point_id) {
            Some(point) if point.area.writable() => write_point(runtime, point, &item.value).await,
            Some(_) => Err(OperationError::new(
                "readOnly",
                "Modbus area is read-only",
                false,
            )),
            None => Err(OperationError::new(
                "unknownPoint",
                "point is not configured",
                false,
            )),
        }
        .map_or_else(crate::read::error_quality, |()| PointQuality::GOOD);
        results.push(WriteItemResult {
            point_id: item.point_id,
            quality,
        });
    }
    Ok(WriteResult {
        correlation_id: request.correlation_id,
        items: results,
    })
}

async fn write_point(
    runtime: &Arc<Runtime>,
    point: &ModbusPoint,
    value: &PointValue,
) -> Result<(), OperationError> {
    let coil = if point.area == ModbusArea::Coils {
        Some(match value {
            PointValue::Bool(value) => *value,
            _ => {
                return Err(OperationError::new(
                    "typeMismatch",
                    "coil writes require a bool",
                    false,
                ));
            }
        })
    } else {
        None
    };
    let words = if point.area == ModbusArea::HoldingRegisters {
        Some(
            encode_registers(point, value)
                .map_err(|error| OperationError::new("encode", &error.to_string(), false))?,
        )
    } else {
        None
    };
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
                match point.area {
                    ModbusArea::Coils => {
                        context
                            .write_single_coil(point.address, coil.expect("validated coil"))
                            .await
                    }
                    ModbusArea::HoldingRegisters => {
                        let words = words.as_ref().expect("validated registers");
                        if words.len() == 1 {
                            context.write_single_register(point.address, words[0]).await
                        } else {
                            context
                                .write_multiple_registers(point.address, words.as_slice())
                                .await
                        }
                    }
                    ModbusArea::DiscreteInputs | ModbusArea::InputRegisters => {
                        unreachable!("writable checked before dispatch")
                    }
                }
            }) => result,
        }
    };
    let result = normalize(result);
    match &result {
        Ok(()) => mark_online(runtime),
        Err(error) if error.disconnect => {
            mark_degraded(runtime, &error.detail);
            runtime.context.lock().await.take();
        }
        Err(_) => mark_online(runtime),
    }
    result
}

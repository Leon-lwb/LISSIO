use crate::client::{
    OperationError, Runtime, ensure_connected, mark_degraded, mark_online, normalize,
};
use crate::read::error_quality;
use crate::{S7Point, encode_point};
use acquisition::{AcquisitionError, AcquisitionResult};
use points::{PointQuality, PointValue, WriteItemResult, WriteRequest, WriteResult};
use std::sync::Arc;
use std::time::Duration;
use tokio_s7::item::{DataItem, RequestItem};
use tokio_s7::types::{S7ParamVariableType, SyntaxID};

pub async fn write_request(
    runtime: &Arc<Runtime>,
    request: WriteRequest,
) -> AcquisitionResult<WriteResult> {
    if request.deadline_unix_ns <= crate::client::now_unix_ns() {
        return Err(AcquisitionError::Timeout);
    }
    let mut results = Vec::with_capacity(request.items.len());
    for item in request.items {
        let quality = match runtime.points.get(&item.point_id) {
            Some(point) if point.area.writable() => write_point(runtime, point, &item.value).await,
            Some(_) => Err(OperationError::new(
                "readOnly",
                "S7 area is read-only",
                false,
            )),
            None => Err(OperationError::new(
                "unknownPoint",
                "point is not configured",
                false,
            )),
        }
        .map_or_else(error_quality, |()| PointQuality::GOOD);
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
    point: &S7Point,
    value: &PointValue,
) -> Result<(), OperationError> {
    let (item, data) = build_request(point, value)?;
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
            result = tokio::time::timeout(timeout, client.write(vec![item], vec![data])) => {
                result
            }
        }
    };
    let result = normalize(result);
    match &result {
        Ok(()) => mark_online(runtime),
        Err(error) if error.disconnect => {
            mark_degraded(runtime, &error.detail);
            runtime.client.lock().await.take();
        }
        Err(_) => mark_online(runtime),
    }
    result
}

/// Bools travel through the native S7 BIT transport (one bit at the byte/bit
/// address), which a real PLC applies without disturbing neighbouring bits;
/// tokio-s7's `write_bool` doc warning does not apply to this wire shape.
/// Real-hardware verification is still pending before the adapter claims
/// certified interop.
fn build_request(
    point: &S7Point,
    value: &PointValue,
) -> Result<(RequestItem, DataItem), OperationError> {
    match point.data_type {
        crate::S7DataType::Bool => {
            let bit = match value {
                PointValue::Bool(bit) => *bit,
                _ => {
                    return Err(OperationError::new(
                        "typeMismatch",
                        "bool writes require a bool value",
                        false,
                    ));
                }
            };
            let item = RequestItem {
                specification_type: 0x12,
                length_of_following: 0x0A,
                syntax_id: SyntaxID::S7Any,
                variable_type: S7ParamVariableType::Bit,
                count: 1,
                db_number: point.db_number,
                area: point.area.to_sdk(),
                byte_address: point.byte_offset,
                bit_address: u32::from(point.bit),
            };
            let data = DataItem::create_req_bool(bit)
                .map_err(|error| OperationError::new("encode", &error.to_string(), false))?;
            Ok((item, data))
        }
        _ => {
            let bytes = encode_point(point, value)
                .map_err(|error| OperationError::new("encode", &error.to_string(), false))?;
            let count = u16::try_from(bytes.len()).map_err(|_| {
                OperationError::new("encode", "write larger than 65535 bytes", false)
            })?;
            let item = RequestItem {
                specification_type: 0x12,
                length_of_following: 0x0A,
                syntax_id: SyntaxID::S7Any,
                variable_type: S7ParamVariableType::Byte,
                count,
                db_number: point.db_number,
                area: point.area.to_sdk(),
                byte_address: point.byte_offset,
                bit_address: 0,
            };
            let data = DataItem::create_req_bytes(bytes)
                .map_err(|error| OperationError::new("encode", &error.to_string(), false))?;
            Ok((item, data))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{S7Area, S7DataType};
    use points::PointId;

    fn point(data_type: S7DataType) -> S7Point {
        S7Point {
            id: PointId("p".into()),
            area: S7Area::Markers,
            db_number: 0,
            byte_offset: 4,
            bit: 3,
            data_type,
            scale: 1.0,
            offset: 0.0,
            poll_period_ms: 100,
        }
    }

    #[test]
    fn bool_writes_use_the_bit_transport_at_the_bit_address() {
        let (item, data) =
            build_request(&point(S7DataType::Bool), &PointValue::Bool(true)).expect("bool request");
        assert_eq!(item.variable_type, S7ParamVariableType::Bit);
        assert_eq!(item.count, 1);
        assert_eq!(item.byte_address, 4);
        assert_eq!(item.bit_address, 3);
        assert_eq!(item.area, tokio_s7::types::S7Area::Flags);
        assert_eq!(
            data.data_variable_type,
            tokio_s7::types::S7DataVariableType::Bit
        );
        assert_eq!(data.count, 1);
        assert_eq!(data.data, vec![0x01]);
    }

    #[test]
    fn numeric_writes_use_the_byte_transport_with_be_bytes() {
        let mut word = point(S7DataType::U16);
        word.bit = 0;
        let (item, data) = build_request(&word, &PointValue::U64(0x1234)).expect("numeric request");
        assert_eq!(item.variable_type, S7ParamVariableType::Byte);
        assert_eq!(item.count, 2);
        assert_eq!(item.bit_address, 0);
        assert_eq!(data.data, vec![0x12, 0x34]);
        assert_eq!(
            data.data_variable_type,
            tokio_s7::types::S7DataVariableType::ByteWordDword
        );
    }

    #[test]
    fn non_bool_values_are_rejected_for_bool_points() {
        let error =
            build_request(&point(S7DataType::Bool), &PointValue::U64(1)).expect_err("mismatch");
        assert_eq!(error.code, "typeMismatch");
        assert!(!error.disconnect);
    }
}

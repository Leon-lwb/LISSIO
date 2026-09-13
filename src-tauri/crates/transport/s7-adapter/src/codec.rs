// PLC 大端定长字节与富类型投影 (f64) 之间显式窄化, 数值合法性由配置校验
// (is_finite) 与整值检查 (fract == 0) 前置保证; scale/offset 的 1.0/0.0
// 恒等判断是配置原值的精确匹配而非计算值比较
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::float_cmp
)]

use crate::{S7DataType, S7Point};
use points::PointValue;

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum CodecError {
    #[error("not enough bytes: need {needed}, got {actual}")]
    ShortInput { needed: usize, actual: usize },
    #[error("point value type is incompatible with {0:?}")]
    TypeMismatch(S7DataType),
    #[error("scaled value is not finite")]
    NonFinite,
    #[error("bit offset {bit} is outside the provided byte")]
    BitOutOfRange { bit: u8 },
}

/// Decode one point from the front of a merged big-endian byte block.
/// Booleans extract their configured bit from the containing byte.
pub fn decode_point(point: &S7Point, bytes: &[u8]) -> Result<PointValue, CodecError> {
    let needed = usize::from(point.read_byte_size());
    if bytes.len() < needed {
        return Err(CodecError::ShortInput {
            needed,
            actual: bytes.len(),
        });
    }
    if point.data_type == S7DataType::Bool {
        let byte = bytes[0];
        return (point.bit < 8)
            .then(|| (byte >> point.bit) & 1 == 1)
            .map(PointValue::Bool)
            .ok_or(CodecError::BitOutOfRange { bit: point.bit });
    }
    let raw = match point.data_type {
        S7DataType::U8 => PointValue::U64(u64::from(bytes[0])),
        S7DataType::I8 => PointValue::I64(i64::from(i8::from_be_bytes([bytes[0]]))),
        S7DataType::U16 => PointValue::U64(u64::from(u16::from_be_bytes([bytes[0], bytes[1]]))),
        S7DataType::I16 => PointValue::I64(i64::from(i16::from_be_bytes([bytes[0], bytes[1]]))),
        S7DataType::U32 => PointValue::U64(u64::from(u32::from_be_bytes(
            bytes[..4].try_into().unwrap(),
        ))),
        S7DataType::I32 => PointValue::I64(i64::from(i32::from_be_bytes(
            bytes[..4].try_into().unwrap(),
        ))),
        S7DataType::U64 => PointValue::U64(u64::from_be_bytes(bytes[..8].try_into().unwrap())),
        S7DataType::I64 => PointValue::I64(i64::from_be_bytes(bytes[..8].try_into().unwrap())),
        S7DataType::F32 => PointValue::F64(f64::from(f32::from_be_bytes(
            bytes[..4].try_into().unwrap(),
        ))),
        S7DataType::F64 => PointValue::F64(f64::from_be_bytes(bytes[..8].try_into().unwrap())),
        S7DataType::Bool => unreachable!("bool handled above"),
    };
    apply_scale(raw, point.scale, point.offset)
}

/// Encode a point value into big-endian wire bytes; bools are rejected here
/// because they travel through the native BIT transport in `write`.
pub fn encode_point(point: &S7Point, value: &PointValue) -> Result<Vec<u8>, CodecError> {
    let unscaled = unscale(value, point.scale, point.offset)?;
    match point.data_type {
        S7DataType::Bool => Err(CodecError::TypeMismatch(S7DataType::Bool)),
        S7DataType::U8 => u8::try_from(as_u64(unscaled, point.data_type)?)
            .map(|value| vec![value])
            .map_err(|_| CodecError::TypeMismatch(point.data_type)),
        S7DataType::I8 => i8::try_from(as_i64(unscaled, point.data_type)?)
            .map(|value| vec![value as u8])
            .map_err(|_| CodecError::TypeMismatch(point.data_type)),
        S7DataType::U16 => u16::try_from(as_u64(unscaled, point.data_type)?)
            .map_err(|_| CodecError::TypeMismatch(point.data_type))
            .map(|value| value.to_be_bytes().to_vec()),
        S7DataType::I16 => i16::try_from(as_i64(unscaled, point.data_type)?)
            .map_err(|_| CodecError::TypeMismatch(point.data_type))
            .map(|value| value.to_be_bytes().to_vec()),
        S7DataType::U32 => u32::try_from(as_u64(unscaled, point.data_type)?)
            .map_err(|_| CodecError::TypeMismatch(point.data_type))
            .map(|value| value.to_be_bytes().to_vec()),
        S7DataType::I32 => i32::try_from(as_i64(unscaled, point.data_type)?)
            .map_err(|_| CodecError::TypeMismatch(point.data_type))
            .map(|value| value.to_be_bytes().to_vec()),
        S7DataType::U64 => Ok(as_u64(unscaled, point.data_type)?.to_be_bytes().to_vec()),
        S7DataType::I64 => Ok(as_i64(unscaled, point.data_type)?.to_be_bytes().to_vec()),
        S7DataType::F32 => Ok((as_f64(unscaled, point.data_type)? as f32)
            .to_be_bytes()
            .to_vec()),
        S7DataType::F64 => Ok(as_f64(unscaled, point.data_type)?.to_be_bytes().to_vec()),
    }
}

fn apply_scale(value: PointValue, scale: f64, offset: f64) -> Result<PointValue, CodecError> {
    if scale == 1.0 && offset == 0.0 {
        return Ok(value);
    }
    let numeric = match value {
        PointValue::I64(value) => value as f64,
        PointValue::U64(value) => value as f64,
        PointValue::F64(value) => value,
        other => return Ok(other),
    };
    let value = numeric.mul_add(scale, offset);
    if value.is_finite() {
        Ok(PointValue::F64(value))
    } else {
        Err(CodecError::NonFinite)
    }
}

fn unscale(value: &PointValue, scale: f64, offset: f64) -> Result<PointValue, CodecError> {
    if scale == 0.0 || !scale.is_finite() || !offset.is_finite() {
        return Err(CodecError::NonFinite);
    }
    if scale == 1.0 && offset == 0.0 {
        return Ok(value.clone());
    }
    let result = (as_f64(value.clone(), S7DataType::F64)? - offset) / scale;
    if result.is_finite() {
        Ok(PointValue::F64(result))
    } else {
        Err(CodecError::NonFinite)
    }
}

fn as_u64(value: PointValue, kind: S7DataType) -> Result<u64, CodecError> {
    match value {
        PointValue::U64(value) => Ok(value),
        PointValue::F64(value) if value.fract() == 0.0 && value >= 0.0 => Ok(value as u64),
        _ => Err(CodecError::TypeMismatch(kind)),
    }
}
fn as_i64(value: PointValue, kind: S7DataType) -> Result<i64, CodecError> {
    match value {
        PointValue::I64(value) => Ok(value),
        PointValue::F64(value) if value.fract() == 0.0 => Ok(value as i64),
        _ => Err(CodecError::TypeMismatch(kind)),
    }
}
fn as_f64(value: PointValue, kind: S7DataType) -> Result<f64, CodecError> {
    match value {
        PointValue::I64(value) => Ok(value as f64),
        PointValue::U64(value) => Ok(value as f64),
        PointValue::F64(value) => Ok(value),
        _ => Err(CodecError::TypeMismatch(kind)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::S7Area;
    use points::PointId;

    fn point(data_type: S7DataType) -> S7Point {
        S7Point {
            id: PointId("p".into()),
            area: S7Area::Db,
            db_number: 10,
            byte_offset: 0,
            bit: 0,
            data_type,
            scale: 1.0,
            offset: 0.0,
            poll_period_ms: 100,
        }
    }

    #[test]
    fn big_endian_roundtrip_for_every_type() {
        let cases: Vec<(S7DataType, PointValue)> = vec![
            (S7DataType::U8, PointValue::U64(0xAB)),
            (S7DataType::I8, PointValue::I64(-3)),
            (S7DataType::U16, PointValue::U64(0x1122)),
            (S7DataType::I16, PointValue::I64(-2)),
            (S7DataType::U32, PointValue::U64(0x1122_3344)),
            (S7DataType::I32, PointValue::I64(-70_589_936)),
            (S7DataType::U64, PointValue::U64(0x1122_3344_5566_7788)),
            (S7DataType::I64, PointValue::I64(-1)),
            (S7DataType::F32, PointValue::F64(f64::from(1.5_f32))),
            (S7DataType::F64, PointValue::F64(2.5)),
        ];
        for (data_type, expected) in cases {
            let point = point(data_type);
            let bytes = encode_point(&point, &expected).unwrap();
            assert_eq!(bytes.len(), usize::from(data_type.byte_size()));
            assert_eq!(decode_point(&point, &bytes).unwrap(), expected);
        }
    }

    #[test]
    fn bool_extracts_the_configured_bit() {
        for bit in 0_u8..8 {
            let mut point = point(S7DataType::Bool);
            point.bit = bit;
            let set = decode_point(&point, &[1 << bit]).unwrap();
            let clear = decode_point(&point, &[!(1 << bit)]).unwrap();
            assert_eq!(set, PointValue::Bool(true));
            assert_eq!(clear, PointValue::Bool(false));
        }
    }

    #[test]
    fn scale_and_offset_apply_in_both_directions() {
        let mut point = point(S7DataType::I16);
        point.scale = 0.5;
        point.offset = 10.0;
        let bytes = encode_point(&point, &PointValue::F64(20.0)).unwrap();
        assert_eq!(decode_point(&point, &bytes).unwrap(), PointValue::F64(20.0));
    }
}

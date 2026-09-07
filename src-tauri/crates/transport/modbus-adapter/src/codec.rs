// 寄存器编解码在协议字宽 (u16/i16/f32) 与富类型投影 (f64) 之间显式窄化,
// 数值合法性由配置校验 (is_finite) 与整值检查 (fract == 0) 前置保证;
// scale/offset 的 1.0/0.0 恒等判断是配置原值的精确匹配而非计算值比较
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::float_cmp
)]

use crate::{ByteOrder, ModbusDataType, ModbusPoint, WordOrder};
use points::PointValue;

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum CodecError {
    #[error("not enough registers: need {needed}, got {actual}")]
    ShortInput { needed: usize, actual: usize },
    #[error("point value type is incompatible with {0:?}")]
    TypeMismatch(ModbusDataType),
    #[error("scaled value is not finite")]
    NonFinite,
}

pub fn decode_registers(point: &ModbusPoint, registers: &[u16]) -> Result<PointValue, CodecError> {
    let needed = usize::from(point.data_type.register_count());
    if registers.len() < needed {
        return Err(CodecError::ShortInput {
            needed,
            actual: registers.len(),
        });
    }
    let bytes = ordered_bytes(point, &registers[..needed]);
    let raw = match point.data_type {
        ModbusDataType::Bool => PointValue::Bool(registers[0] != 0),
        ModbusDataType::U16 => PointValue::U64(u64::from(u16::from_be_bytes([bytes[0], bytes[1]]))),
        ModbusDataType::I16 => PointValue::I64(i64::from(i16::from_be_bytes([bytes[0], bytes[1]]))),
        ModbusDataType::U32 => PointValue::U64(u64::from(u32::from_be_bytes(
            bytes[..4].try_into().unwrap(),
        ))),
        ModbusDataType::I32 => PointValue::I64(i64::from(i32::from_be_bytes(
            bytes[..4].try_into().unwrap(),
        ))),
        ModbusDataType::U64 => PointValue::U64(u64::from_be_bytes(bytes[..8].try_into().unwrap())),
        ModbusDataType::I64 => PointValue::I64(i64::from_be_bytes(bytes[..8].try_into().unwrap())),
        ModbusDataType::F32 => PointValue::F64(f64::from(f32::from_be_bytes(
            bytes[..4].try_into().unwrap(),
        ))),
        ModbusDataType::F64 => PointValue::F64(f64::from_be_bytes(bytes[..8].try_into().unwrap())),
    };
    apply_scale(raw, point.scale, point.offset)
}

pub fn encode_registers(point: &ModbusPoint, value: &PointValue) -> Result<Vec<u16>, CodecError> {
    let unscaled = unscale(value, point.scale, point.offset)?;
    let bytes = match point.data_type {
        ModbusDataType::Bool => return Err(CodecError::TypeMismatch(ModbusDataType::Bool)),
        ModbusDataType::U16 => u16::try_from(as_u64(unscaled, point.data_type)?)
            .map_err(|_| CodecError::TypeMismatch(point.data_type))?
            .to_be_bytes()
            .to_vec(),
        ModbusDataType::I16 => i16::try_from(as_i64(unscaled, point.data_type)?)
            .map_err(|_| CodecError::TypeMismatch(point.data_type))?
            .to_be_bytes()
            .to_vec(),
        ModbusDataType::U32 => u32::try_from(as_u64(unscaled, point.data_type)?)
            .map_err(|_| CodecError::TypeMismatch(point.data_type))?
            .to_be_bytes()
            .to_vec(),
        ModbusDataType::I32 => i32::try_from(as_i64(unscaled, point.data_type)?)
            .map_err(|_| CodecError::TypeMismatch(point.data_type))?
            .to_be_bytes()
            .to_vec(),
        ModbusDataType::U64 => as_u64(unscaled, point.data_type)?.to_be_bytes().to_vec(),
        ModbusDataType::I64 => as_i64(unscaled, point.data_type)?.to_be_bytes().to_vec(),
        ModbusDataType::F32 => (as_f64(unscaled, point.data_type)? as f32)
            .to_be_bytes()
            .to_vec(),
        ModbusDataType::F64 => as_f64(unscaled, point.data_type)?.to_be_bytes().to_vec(),
    };
    Ok(unorder_bytes(point, bytes))
}

fn ordered_bytes(point: &ModbusPoint, registers: &[u16]) -> Vec<u8> {
    let mut words: Vec<[u8; 2]> = registers.iter().map(|word| word.to_be_bytes()).collect();
    if point.word_order == WordOrder::Little {
        words.reverse();
    }
    if point.byte_order == ByteOrder::Little {
        for word in &mut words {
            word.swap(0, 1);
        }
    }
    words.into_iter().flatten().collect()
}

fn unorder_bytes(point: &ModbusPoint, bytes: Vec<u8>) -> Vec<u16> {
    let mut words: Vec<[u8; 2]> = bytes
        .chunks_exact(2)
        .map(|chunk| [chunk[0], chunk[1]])
        .collect();
    if point.byte_order == ByteOrder::Little {
        for word in &mut words {
            word.swap(0, 1);
        }
    }
    if point.word_order == WordOrder::Little {
        words.reverse();
    }
    words.into_iter().map(u16::from_be_bytes).collect()
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
    let result = (as_f64(value.clone(), ModbusDataType::F64)? - offset) / scale;
    if result.is_finite() {
        Ok(PointValue::F64(result))
    } else {
        Err(CodecError::NonFinite)
    }
}

fn as_u64(value: PointValue, kind: ModbusDataType) -> Result<u64, CodecError> {
    match value {
        PointValue::U64(value) => Ok(value),
        PointValue::F64(value) if value.fract() == 0.0 && value >= 0.0 => Ok(value as u64),
        _ => Err(CodecError::TypeMismatch(kind)),
    }
}
fn as_i64(value: PointValue, kind: ModbusDataType) -> Result<i64, CodecError> {
    match value {
        PointValue::I64(value) => Ok(value),
        PointValue::F64(value) if value.fract() == 0.0 => Ok(value as i64),
        _ => Err(CodecError::TypeMismatch(kind)),
    }
}
fn as_f64(value: PointValue, kind: ModbusDataType) -> Result<f64, CodecError> {
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
    use crate::ModbusArea;
    use points::PointId;

    fn point(byte_order: ByteOrder, word_order: WordOrder) -> ModbusPoint {
        ModbusPoint {
            id: PointId("p".into()),
            area: ModbusArea::HoldingRegisters,
            address: 0,
            data_type: ModbusDataType::U32,
            byte_order,
            word_order,
            scale: 1.0,
            offset: 0.0,
            poll_period_ms: 100,
        }
    }

    #[test]
    fn byte_and_word_order_are_explicit_and_reversible() {
        let expected = PointValue::U64(0x1122_3344);
        for byte in [ByteOrder::Big, ByteOrder::Little] {
            for word in [WordOrder::Big, WordOrder::Little] {
                let point = point(byte, word);
                let registers = encode_registers(&point, &expected).unwrap();
                assert_eq!(decode_registers(&point, &registers).unwrap(), expected);
            }
        }
    }
}

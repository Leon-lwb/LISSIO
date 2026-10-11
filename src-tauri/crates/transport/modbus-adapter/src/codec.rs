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
    let mut words: Vec<[u8; 2]> = bytes.as_chunks::<2>().0.to_vec();
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
    points::scale::apply_scale(value, scale, offset).map_err(map_scale_error)
}

fn unscale(value: &PointValue, scale: f64, offset: f64) -> Result<PointValue, CodecError> {
    points::scale::unscale(value, scale, offset).map_err(map_scale_error)
}

fn as_u64(value: PointValue, kind: ModbusDataType) -> Result<u64, CodecError> {
    points::scale::as_u64(value).map_err(|_| CodecError::TypeMismatch(kind))
}

fn as_i64(value: PointValue, kind: ModbusDataType) -> Result<i64, CodecError> {
    points::scale::as_i64(value).map_err(|_| CodecError::TypeMismatch(kind))
}

fn as_f64(value: PointValue, kind: ModbusDataType) -> Result<f64, CodecError> {
    points::scale::as_f64(value).map_err(|_| CodecError::TypeMismatch(kind))
}

/// 缩放失败 → codec 错误 (类型不匹配沿用原始实现的 F64 标记)
const fn map_scale_error(error: points::scale::ScaleError) -> CodecError {
    match error {
        points::scale::ScaleError::NonFinite => CodecError::NonFinite,
        points::scale::ScaleError::TypeMismatch => CodecError::TypeMismatch(ModbusDataType::F64),
    }
}

#[cfg(test)]
#[path = "codec_tests.rs"]
mod tests;

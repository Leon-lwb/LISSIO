//! `PointValue` 缩放与数值转换 — 适配器 codec 的共享内核。
//!
//! modbus 与 s7 两个 L4 适配器各自复制过同一份实现; 这里持有唯一版本,
//! 适配器只把 [`ScaleError`] 映射到自己的 `CodecError` 变体。
//!
//! 协议字宽 (i64/u64/f64) 之间显式窄化, 数值合法性由配置校验 (`is_finite`)
//! 与整值检查 (`fract == 0`) 前置保证; `scale`/`offset` 的 1.0/0.0 恒等判断是
//! 配置原值的精确匹配而非计算值比较。
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::float_cmp
)]

use crate::PointValue;

/// 缩放/转换失败原因 — 调用方映射到各自的错误类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScaleError {
    /// 缩放系数或偏移非法, 或结果非有限
    NonFinite,
    /// 值类型不参与数值缩放/转换
    TypeMismatch,
}

/// 应用 `scale`/`offset` — 仅 I64/U64/F64 参与, 其余类型原样返回
///
/// # Errors
/// 结果非有限时返回 [`ScaleError::NonFinite`]。
pub fn apply_scale(value: PointValue, scale: f64, offset: f64) -> Result<PointValue, ScaleError> {
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
        Err(ScaleError::NonFinite)
    }
}

/// 反缩放 — `(value - offset) / scale`
///
/// # Errors
/// 系数非法或结果非有限时返回 [`ScaleError::NonFinite`]; 值不是数值类型时返回
/// [`ScaleError::TypeMismatch`]。
pub fn unscale(value: &PointValue, scale: f64, offset: f64) -> Result<PointValue, ScaleError> {
    if scale == 0.0 || !scale.is_finite() || !offset.is_finite() {
        return Err(ScaleError::NonFinite);
    }
    if scale == 1.0 && offset == 0.0 {
        return Ok(value.clone());
    }
    let result = (as_f64(value.clone())? - offset) / scale;
    if result.is_finite() {
        Ok(PointValue::F64(result))
    } else {
        Err(ScaleError::NonFinite)
    }
}

/// 取无符号整数 — 整值非负 F64 可转换
///
/// # Errors
/// 类型不匹配时返回 [`ScaleError::TypeMismatch`]。
pub fn as_u64(value: PointValue) -> Result<u64, ScaleError> {
    match value {
        PointValue::U64(value) => Ok(value),
        PointValue::F64(value) if value.fract() == 0.0 && value >= 0.0 => Ok(value as u64),
        _ => Err(ScaleError::TypeMismatch),
    }
}

/// 取有符号整数 — 整值 F64 可转换
///
/// # Errors
/// 类型不匹配时返回 [`ScaleError::TypeMismatch`]。
pub fn as_i64(value: PointValue) -> Result<i64, ScaleError> {
    match value {
        PointValue::I64(value) => Ok(value),
        PointValue::F64(value) if value.fract() == 0.0 => Ok(value as i64),
        _ => Err(ScaleError::TypeMismatch),
    }
}

/// 取 f64 — I64/U64/F64 均可无损进入数值域
///
/// # Errors
/// 类型不匹配时返回 [`ScaleError::TypeMismatch`]。
pub fn as_f64(value: PointValue) -> Result<f64, ScaleError> {
    match value {
        PointValue::I64(value) => Ok(value as f64),
        PointValue::U64(value) => Ok(value as f64),
        PointValue::F64(value) => Ok(value),
        _ => Err(ScaleError::TypeMismatch),
    }
}

#[cfg(test)]
#[path = "scale_tests.rs"]
mod tests;

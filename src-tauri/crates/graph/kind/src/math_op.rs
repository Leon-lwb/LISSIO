//! 算术运算 — MathOp 枚举 + evaluate 方法
//!
//! 与前端 types/index.ts 中的 MathOp 保持一致 (snake_case)

use serde::{Deserialize, Serialize};

/// 算术运算种类
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum MathOp {
    Add,
    Sub,
    Mul,
    Div,
    Avg,
    Min,
    Max,
    Abs,
    Neg,
    Square,
    Sqrt,
    Sin,
    Cos,
    Tan,
    Log,
}

impl MathOp {
    /// 评估算术运算 — 输入数组, 输出单值
    /// 与前端 computeMathResult 保持一致的语义
    #[allow(clippy::cast_precision_loss)]
    pub fn evaluate(&self, inputs: &[f32]) -> f32 {
        let values = inputs.iter().copied().filter(|v| !v.is_nan());
        let Some(first) = values.clone().next() else {
            return 0.0;
        };
        match self {
            Self::Add => values.sum(),
            Self::Sub => values.reduce(|a, b| a - b).unwrap_or(0.0),
            Self::Mul => values.reduce(|a, b| a * b).unwrap_or(1.0),
            Self::Div => values
                .skip(1)
                .fold(first, |a, b| if b == 0.0 { 0.0 } else { a / b }),
            Self::Avg => values.clone().sum::<f32>() / values.count() as f32,
            Self::Min => values.fold(f32::INFINITY, f32::min),
            Self::Max => values.fold(f32::NEG_INFINITY, f32::max),
            Self::Abs => first.abs(),
            Self::Neg => -first,
            Self::Square => first * first,
            Self::Sqrt => {
                if first < 0.0 {
                    0.0
                } else {
                    first.sqrt()
                }
            }
            Self::Sin => first.sin(),
            Self::Cos => first.cos(),
            Self::Tan => first.tan(),
            Self::Log => {
                if first <= 0.0 {
                    0.0
                } else {
                    first.ln()
                }
            }
        }
    }
}

#[cfg(test)]
// 测试结果均为精确可表示的值 (小整数 f32), 直接断言相等
#[allow(clippy::float_cmp)]
#[path = "math_op_tests.rs"]
mod tests;

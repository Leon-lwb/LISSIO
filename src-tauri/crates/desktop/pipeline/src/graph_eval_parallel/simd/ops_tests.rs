#![allow(clippy::cast_precision_loss)] // LCG 伪随机输入: 小整型 → f32 有意截断
#![allow(clippy::needless_range_loop)] // 列下标 f 同时索引多列, 迭代器反而更绕

use super::*;
use kind::MathOp;

/// 全 MathOp × 全 arity (1..=3) × 随机+边缘输入: SIMD/融合路径与参考
/// `MathOp::evaluate` 逐位一致 (含 NaN / ±0 / ±inf / 域守卫边界)
#[allow(clippy::needless_range_loop)]
fn ref_eval(op: MathOp, inputs: &[&[f32]], f: usize) -> f32 {
    let mut buf = vec![0.0f32; inputs.len()];
    for (i, col) in inputs.iter().enumerate() {
        buf[i] = col[f];
    }
    op.evaluate(&buf)
}

fn bit_eq(a: f32, b: f32) -> bool {
    a.to_bits() == b.to_bits()
}

#[test]
fn all_ops_match_reference_bitwise() {
    let edge = [
        0.0,
        -0.0,
        1.0,
        -1.0,
        0.5,
        -0.5,
        3.0,
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::NAN,
        -2.0, // sqrt/log 域守卫
        1e8,  // 大参数三角
    ];
    let ops = [
        MathOp::Add,
        MathOp::Sub,
        MathOp::Mul,
        MathOp::Div,
        MathOp::Avg,
        MathOp::Min,
        MathOp::Max,
        MathOp::Abs,
        MathOp::Neg,
        MathOp::Square,
        MathOp::Sqrt,
        MathOp::Sin,
        MathOp::Cos,
        MathOp::Tan,
        MathOp::Log,
    ];
    for op in ops {
        for arity in 1..=3usize {
            // 确定性 LCG 输入混入边缘值
            let mut seed = 0xdead_beef_u32 ^ u32::try_from(arity).unwrap_or(1);
            let cols: Vec<Vec<f32>> = (0..arity)
                .map(|_| {
                    (0..257)
                        .map(|f| {
                            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                            if f % 7 == 0 {
                                edge[(seed % 12) as usize]
                            } else {
                                ((seed >> 8) % 20_000) as f32 / 100.0 - 100.0
                            }
                        })
                        .collect()
                })
                .collect();
            let refs: Vec<&[f32]> = cols.iter().map(Vec::as_slice).collect();
            let n = cols[0].len();
            let mut ws = SimdWorkspace::default();
            for (slot, col) in cols.iter().enumerate() {
                ws.ensure_col(slot, n);
                ws.cols[slot][..n].copy_from_slice(col);
            }
            let plan = SimdMathOp {
                op,
                inputs: (0..arity).map(Some).collect(),
                out: arity,
            };
            ws.ensure_col(plan.out, n);
            let mut out_col = std::mem::take(&mut ws.cols[plan.out]);
            apply_math_op(&plan, &ws, &mut out_col[..n]);
            for f in 0..n {
                let expect = ref_eval(op, &refs, f);
                assert!(
                    bit_eq(out_col[f], expect),
                    "{op:?} arity {arity} frame {f}: got {} want {expect}",
                    out_col[f]
                );
            }
        }
    }
}

/// 未连接输入 = 常量 0.0 列 (None): 与 CPU `map_or(0.0)` 一致
#[test]
fn unconnected_input_is_zero() {
    for op in [MathOp::Add, MathOp::Mul, MathOp::Sin] {
        let x = [2.0, f32::NAN, -4.0];
        let mut ws = SimdWorkspace::default();
        ws.ensure_col(0, 3);
        ws.cols[0][..3].copy_from_slice(&x);
        let plan = SimdMathOp {
            op,
            inputs: vec![Some(0), None],
            out: 1,
        };
        ws.ensure_col(1, 3);
        let mut out_col = std::mem::take(&mut ws.cols[1]);
        apply_math_op(&plan, &ws, &mut out_col[..3]);
        for f in 0..3 {
            let mut buf = [0.0f32; 2];
            buf[0] = x[f];
            assert!(bit_eq(out_col[f], op.evaluate(&buf)));
        }
    }
}

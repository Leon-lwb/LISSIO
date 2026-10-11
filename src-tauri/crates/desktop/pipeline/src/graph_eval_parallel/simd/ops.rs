//! 批量 Math op 求值 — SoA 列上的 SIMD/标量混合分派
//!
//! 数值契约: 每个算子路径与 [`MathOp::evaluate`] (arity 维度上逐帧展开) **逐位
//! 一致**:
//! - Add/Mul (任意元): NaN→替代元净化后, 从恒起点 (-0.0/1.0) 做链式 SIMD 归约 —
//!   精确复刻 std `sum()` 的 `fold(-0.0, add)` 与 `reduce` 的 `1.0*a == a`
//!   恒等序 (IEEE 加/乘逐位一致, SIMD 与标量同序); 全 NaN 列修复为 +0.0
//!   (CPU 空集提前返回语义)
//! - arity 1: 融合单遍 (净化 + 求值), 公式逐条取自 `MathOp::evaluate` 的
//!   vals==[x]/vals==[] 分支
//! - 其余: 列式标量循环逐帧调用 `MathOp::evaluate` 本身 (参考函数, 天然一致)
//!
//! NaN 输入与空集语义 (空集一律提前返回 0.0, 含 Mul/Min/Max)、除零→0.0、
//! sqrt/log 域守卫全部由上述复刻覆盖; 中间 inf-inf=NaN 不做二次过滤 (与
//! CPU 归约一致)。

use scirs2_core::simd_ops::SimdUnifiedOps;

use kind::MathOp;

use super::plans::{SimdMathOp, SimdUnitPlan};

/// SoA 列工作区 — 槽位 → 块内帧值列 (每桶每图一份, 跨块复用容量)
#[derive(Default)]
pub struct SimdWorkspace {
    /// 槽位下标 → 块内帧值列 (懒增长; 内容每块全量覆盖)
    cols: Vec<Vec<f32>>,
    /// 常量 0.0 列 (未连接输入; 与 CPU `map_or(0.0, ...)` 一致)
    zeros: Vec<f32>,
}

impl SimdWorkspace {
    /// 确保槽位 `slot` 的列存在且长度 ≥ `n` (零填充, 内容随后全量覆盖)
    pub fn ensure_col(&mut self, slot: usize, n: usize) {
        if self.cols.len() <= slot {
            self.cols.resize(slot + 1, Vec::new());
        }
        let col = &mut self.cols[slot];
        if col.len() < n {
            col.resize(n, 0.0);
        }
        if self.zeros.len() < n {
            self.zeros.resize(n, 0.0);
        }
    }

    /// 槽位列只读切片 (调用方保证 [`Self::ensure_col`] 先行)
    pub fn col(&self, slot: usize) -> &[f32] {
        &self.cols[slot]
    }

    /// gather: 块内第 `f` 帧的槽位值写入列 (逐帧 prelude 后调用)
    pub fn gather(&mut self, slot: usize, f: usize, value: f32) {
        self.cols[slot][f] = value;
    }

    /// 槽位列只读切片 (调用方保证 [`Self::ensure_col`] 先行)
    fn col_len(&self, slot: usize, n: usize) -> &[f32] {
        &self.cols[slot][..n]
    }
}

/// 批量求值一个 SIMD 资格单元 — 按拓扑序逐 op 写输出列
pub fn apply_unit(unit: &SimdUnitPlan, ws: &mut SimdWorkspace, n: usize) {
    for op in &unit.ops {
        let out_slot = op.out;
        ws.ensure_col(out_slot, n);
        // mem::take 隔离输出列借用 (输出槽位与输入槽位互斥, 无别名)
        let mut out_col = std::mem::take(&mut ws.cols[out_slot]);
        apply_math_op(op, ws, &mut out_col[..n]);
        ws.cols[out_slot] = out_col;
    }
}

/// 单 op 批量求值 — 分派见模块注释
fn apply_math_op(op: &SimdMathOp, ws: &SimdWorkspace, out: &mut [f32]) {
    let n = out.len();
    let in_cols: Vec<&[f32]> = op
        .inputs
        .iter()
        .map(|s| {
            s.as_ref()
                .map_or_else(|| &ws.zeros[..n], |slot| ws.col_len(*slot, n))
        })
        .collect();
    match op.op {
        MathOp::Add | MathOp::Mul => reduce_chain(op.op, &in_cols, out),
        MathOp::Min | MathOp::Max if in_cols.len() == 1 => {
            // 单输入: min(+inf, x) = x / max(-inf, x) = x, 空集 0.0 → 净化即可
            clean_copy(in_cols[0], out, 0.0);
        }
        _ if in_cols.len() == 1 => unary_column(op.op, in_cols[0], out),
        _ => scalar_column(op.op, &in_cols, out),
    }
}

/// NaN → 恒等净化拷贝 (identity: Add 系 0.0 / Mul 系 1.0)
fn clean_copy(x: &[f32], out: &mut [f32], identity: f32) {
    for (o, v) in out.iter_mut().zip(x.iter()) {
        *o = if v.is_nan() { identity } else { *v };
    }
}

/// Add/Mul 链式归约 — 恒起点复刻 `sum()` / `reduce` 折叠序
///
/// std 浮点 `Sum` 从 **-0.0** 起折叠 (`-0.0 + x = x` 全域保号恒等), 空集
/// 提前返回 +0.0; `Product` 从 1.0 起折叠 (`1.0 * x = x` 恒等, 含 ±0/±inf),
/// 空集 1.0。NaN 输入替代元: 加法 -0.0 (`acc + -0.0 = acc` 恒等), 乘法 1.0。
fn reduce_chain(op: MathOp, in_cols: &[&[f32]], out: &mut [f32]) {
    use scirs2_core::ndarray::Array1;
    let is_mul = op == MathOp::Mul;
    let identity = if is_mul { 1.0 } else { -0.0 };
    let mut acc = Array1::from(vec![identity; out.len()]);
    let mut any_nan = false;
    for col in in_cols {
        let mut clean = vec![identity; col.len()];
        for (c, v) in clean.iter_mut().zip(col.iter()) {
            if v.is_nan() {
                any_nan = true;
            } else {
                *c = *v;
            }
        }
        let clean = Array1::from(clean);
        acc = if is_mul {
            f32::simd_mul(&acc.view(), &clean.view())
        } else {
            f32::simd_add(&acc.view(), &clean.view())
        };
    }
    let mut acc = acc.into_raw_vec_and_offset().0;
    if any_nan {
        // 全 NaN 列 → 0.0: CPU `vals.is_empty()` 提前返回发生在 match 之前,
        // 对全部算子生效 (Mul 的 unwrap_or(1.0) 是不可达死代码); 折叠值域无法
        // 区分该分支, 按输入掩码修复
        for (f, o) in acc.iter_mut().enumerate() {
            if in_cols.iter().all(|col| col[f].is_nan()) {
                *o = 0.0;
            }
        }
    }
    out.copy_from_slice(&acc);
}

/// arity 1 列式求值 — 融合净化单遍, 公式逐条对齐 `MathOp::evaluate`
fn unary_column(op: MathOp, x: &[f32], out: &mut [f32]) {
    for (o, v) in out.iter_mut().zip(x.iter()) {
        // NaN 输入 → vals 空 → v0 = 0.0 (CPU evaluate 的空集语义)
        *o = if v.is_nan() {
            0.0
        } else {
            match op {
                // 归约类单输入: [x] 起始折叠结果即 x 本身
                MathOp::Add | MathOp::Sub | MathOp::Div | MathOp::Avg => *v,
                MathOp::Mul => *v,
                MathOp::Min | MathOp::Max => *v,
                MathOp::Abs => v.abs(),
                MathOp::Neg => -*v,
                MathOp::Square => v * v,
                MathOp::Sqrt => {
                    if *v < 0.0 {
                        0.0
                    } else {
                        v.sqrt()
                    }
                }
                MathOp::Sin => v.sin(),
                MathOp::Cos => v.cos(),
                MathOp::Tan => v.tan(),
                MathOp::Log => {
                    if *v <= 0.0 {
                        0.0
                    } else {
                        v.ln()
                    }
                }
            }
        };
    }
}

/// 列式标量循环 — 逐帧收集输入后调用 `MathOp::evaluate` (参考函数本身)
fn scalar_column(op: MathOp, in_cols: &[&[f32]], out: &mut [f32]) {
    let arity = in_cols.len();
    let mut stack = [0.0f32; 16];
    let mut heap;
    let buf: &mut [f32] = if arity <= 16 {
        &mut stack[..arity]
    } else {
        heap = vec![0.0; arity];
        &mut heap
    };
    for (f, o) in out.iter_mut().enumerate() {
        for (i, col) in in_cols.iter().enumerate() {
            buf[i] = col[f];
        }
        *o = op.evaluate(buf);
    }
}

#[cfg(test)]
#[path = "ops_tests.rs"]
mod tests;

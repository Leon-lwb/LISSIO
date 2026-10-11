//! 字符串操作 — `StrOp` 枚举 + `StrResult` + `StrNumParams` + 评估实现.
//!
//! 模块拆分（评估逻辑下沉到子文件以保持 ≤ 500 行）：
//! - 端口表（单一事实源）：[`input_ports`]
//! - 评估实现：[`eval`]
//!
//! 语义规范:
//! - 索引 1-based（POS 从 1 开始；FIND 命中返回 1-based 位置，未找到返回 0）
//! - 数值参数 `round()` 后 `clamp` 到 `>= 0`；POS `clamp` 到 `[1, len+1]`
//! - LEN/SIZE = 0 表示 "到末尾/全部"（Left/Right SIZE=0 → 整串；
//!   Mid/Delete/Replace LEN=0 → 从 POS 到末尾）
//! - 越界/空输入不报错：截取越界返回可用部分或空串；
//!   DELETE/REPLACE 的 POS 超出长度时为 no-op（返回原串）
//! - 字符串索引按 `chars()` 字符计，不用字节索引（多字节字符安全）
//!
//! 转换算子（数值 ↔ 文本，源间互转的桥）：
//! - FORMAT：模板字符串（`tmpl` 参数 / fmt 端口动态输入）引用 `{N}`、精度 `{N:.P}`，
//!   把最多 4 路数值通道格式化为文本（发往文本协议设备的桥）
//! - PARSE：从 POS 起（1-based 字符）扫描首个数字 token（十进制含指数 / 0x 十六进制，
//!   十六进制不取符号），解析为 f32；未命中返回 0.0（对齐 FIND 未找到语义）
//! - ENCODE_HEX：输入串 UTF-8 字节的大写 HEX 表示（二进制观测 / 文本化）

mod eval;
mod input_ports;

use serde::{Deserialize, Serialize};

use crate::ports::{PortDomain, PortSpec};

pub use input_ports::{input_ports_for, output_domain_for};

/// 字符串操作种类
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
pub enum StrOp {
    Len,
    Find,
    Contains,
    Left,
    Right,
    Mid,
    Concat,
    Insert,
    Delete,
    Replace,
    Upper,
    Lower,
    Trim,
    Reverse,
    /// 数值 → 文本格式化：模板 `{N}` 引用第 N 路 (0-based)、`{N:.P}` 定精度、
    /// `{{`/`}}` 字面转义；无法解析的 `{N}` 片段原样输出
    Format,
    /// 文本 → 数值解析（见模块头转换算子说明）
    Parse,
    /// UTF-8 字节 → 大写 HEX 文本
    #[serde(rename = "encode_hex")]
    EncodeHex,
}

/// 字符串操作结果 — 文本或数值
#[derive(Debug, Clone, PartialEq)]
pub enum StrResult {
    Text(String),
    Num(f32),
}

/// 数值端口（pos/len/size）的内联默认值
///
/// 端口未连接时求值使用此处的回退值；端口已连接时忽略。各 op 只用与自己相关的字段。
/// 默认值：pos = 1（1-based 起点），len/size = 0（到末尾/全部）
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, ts_rs::TS)]
pub struct StrNumParams {
    pub pos: f32,
    pub len: f32,
    pub size: f32,
}

impl Default for StrNumParams {
    fn default() -> Self {
        Self {
            pos: 1.0,
            len: 0.0,
            size: 0.0,
        }
    }
}

/// Str 数值端口的内联回退值 (端口未连接时使用): 端口名 → [`StrNumParams`] 字段。
/// 快/慢两条求值路径共享 (lowering 编译期捕获 + 慢路径逐帧回退)。
pub fn str_num_default(num: &StrNumParams, port: &str) -> f32 {
    match port {
        "pos" => num.pos,
        "len" => num.len,
        "size" => num.size,
        _ => 0.0,
    }
}

impl StrOp {
    /// 输入端口表（按固定顺序 — 求值的 `str_inputs` / `num_inputs` 依此取参）
    pub const fn input_ports(&self) -> &'static [PortSpec] {
        input_ports_for(*self)
    }

    /// 输出端口 "result" 的域：`Len`/`Find`/`Contains` = F32，其余 = String
    pub const fn output_domain(&self) -> PortDomain {
        output_domain_for(*self)
    }

    /// 该 (op, 输入端口) 是否取内联回退文本 [`crate::kind::NodeKind::Str::tmpl`] —
    /// 单一事实源：仅 FORMAT 的 "fmt" 端口。lowering / 快慢两条求值路径共用。
    pub fn uses_inline_text_default(self, port: &str) -> bool {
        matches!(self, Self::Format) && port == "fmt"
    }

    /// 字符串操作评估 — 输入顺序与 `input_ports()` 一致
    ///
    /// 缺省防御：缺失的字符串输入按 `""` 处理，数值按 `0.0` 处理。
    pub fn evaluate(&self, str_inputs: &[&str], num_inputs: &[f32]) -> StrResult {
        eval::evaluate(*self, str_inputs, num_inputs)
    }
}

#[cfg(test)]
mod tests;

//! `StrOp` 端口表 — 单一事实源（`port_table()` 与求值均消费该表）.

use crate::ports::{PortDomain, PortSpec};

// 端口表常量 — 求值时按 (str_inputs, num_inputs) 顺序取参.
// 设计: 每个 op 复用同一组常量, 仅增删条目; 求值侧不再硬编码顺序.

const IN_STR: &[PortSpec] = &[PortSpec::new("str", PortDomain::String)];
const IN_STR_SUBSTR: &[PortSpec] = &[
    PortSpec::new("str", PortDomain::String),
    PortSpec::new("substr", PortDomain::String),
];
const IN_STR_SIZE: &[PortSpec] = &[
    PortSpec::new("str", PortDomain::String),
    PortSpec::new("size", PortDomain::F32),
];
const IN_STR_POS_LEN: &[PortSpec] = &[
    PortSpec::new("str", PortDomain::String),
    PortSpec::new("pos", PortDomain::F32),
    PortSpec::new("len", PortDomain::F32),
];
const IN_STR1_STR2: &[PortSpec] = &[
    PortSpec::new("str1", PortDomain::String),
    PortSpec::new("str2", PortDomain::String),
];
const IN_STR1_STR2_POS: &[PortSpec] = &[
    PortSpec::new("str1", PortDomain::String),
    PortSpec::new("str2", PortDomain::String),
    PortSpec::new("pos", PortDomain::F32),
];
const IN_STR1_STR2_POS_LEN: &[PortSpec] = &[
    PortSpec::new("str1", PortDomain::String),
    PortSpec::new("str2", PortDomain::String),
    PortSpec::new("pos", PortDomain::F32),
    PortSpec::new("len", PortDomain::F32),
];
/// FORMAT: 模板端口 (未连接时回退 `tmpl` 参数) + 4 路数值引用
const IN_FMT_NUM4: &[PortSpec] = &[
    PortSpec::new("fmt", PortDomain::String),
    PortSpec::new("in0", PortDomain::F32),
    PortSpec::new("in1", PortDomain::F32),
    PortSpec::new("in2", PortDomain::F32),
    PortSpec::new("in3", PortDomain::F32),
];
/// PARSE: 源文本 + 1-based 扫描起点 (复用 StrNumParams.pos 默认 1)
const IN_STR_POS: &[PortSpec] = &[
    PortSpec::new("str", PortDomain::String),
    PortSpec::new("pos", PortDomain::F32),
];

/// 输入端口表查找 — 单一事实源.
pub const fn input_ports_for(op: super::StrOp) -> &'static [PortSpec] {
    use super::StrOp::*;
    match op {
        Len | Upper | Lower | Trim | Reverse | EncodeHex => IN_STR,
        Find | Contains => IN_STR_SUBSTR,
        Left | Right => IN_STR_SIZE,
        Mid | Delete => IN_STR_POS_LEN,
        Concat => IN_STR1_STR2,
        Insert => IN_STR1_STR2_POS,
        Replace => IN_STR1_STR2_POS_LEN,
        Format => IN_FMT_NUM4,
        Parse => IN_STR_POS,
    }
}

/// 输出端口 "result" 的域: `Len`/`Find`/`Contains`/`Parse` = F32, 其余 = String.
pub const fn output_domain_for(op: super::StrOp) -> PortDomain {
    use super::StrOp::*;
    match op {
        Len | Find | Contains | Parse => PortDomain::F32,
        _ => PortDomain::String,
    }
}

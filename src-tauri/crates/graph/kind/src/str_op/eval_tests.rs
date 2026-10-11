// PARSE 结果均为小整数/精确表示的 f32, assert_eq! 严格比较是有意为之
#![allow(clippy::float_cmp)]

use crate::ports::{PortDomain, PortSpec};
use crate::str_op::{StrOp, StrResult};

fn text(r: StrResult) -> String {
    match r {
        StrResult::Text(t) => t,
        StrResult::Num(n) => panic!("expected Text, got Num({n})"),
    }
}

fn num(r: StrResult) -> f32 {
    match r {
        StrResult::Num(n) => n,
        StrResult::Text(t) => panic!("expected Num, got Text({t:?})"),
    }
}

fn evaluate(op: StrOp, str_inputs: &[&str], num_inputs: &[f32]) -> StrResult {
    op.evaluate(str_inputs, num_inputs)
}

#[test]
fn format_basic_refs_and_escapes() {
    assert_eq!(
        text(evaluate(StrOp::Format, &["{0}={1}"], &[1.5, -2.25])),
        "1.5=-2.25"
    );
    assert_eq!(text(evaluate(StrOp::Format, &["{{}}{0}"], &[7.0])), "{}7");
    // 越界/非法引用原样输出
    assert_eq!(text(evaluate(StrOp::Format, &["{5}"], &[1.0])), "{5}");
    assert_eq!(text(evaluate(StrOp::Format, &["{a}"], &[1.0])), "{a}");
    assert_eq!(text(evaluate(StrOp::Format, &["{0"], &[1.0])), "{0");
    assert_eq!(text(evaluate(StrOp::Format, &["}"], &[])), "}");
}

#[test]
#[allow(clippy::literal_string_with_formatting_args)] // 模板字面量本就是被测对象
fn format_precision_and_missing_inputs() {
    assert_eq!(
        text(evaluate(StrOp::Format, &["{0:.2}|{1:.0}"], &[3.5, 9.6])),
        "3.50|10"
    );
    // 未连接的数值输入缺省 0.0 (由调用方收参保证; 这里直接验证缺省行为)
    assert_eq!(text(evaluate(StrOp::Format, &["v={0}"], &[])), "v=0");
    // 未连接 fmt 缺省空模板 → 输出空串
    assert_eq!(text(evaluate(StrOp::Format, &[], &[1.0])), "");
}

#[test]
fn parse_decimal_forms() {
    assert_eq!(num(evaluate(StrOp::Parse, &["temp=12.75,C"], &[])), 12.75);
    assert_eq!(num(evaluate(StrOp::Parse, &["x-3e2y"], &[])), -300.0);
    assert_eq!(num(evaluate(StrOp::Parse, &[".5 and 2"], &[])), 0.5);
    assert_eq!(num(evaluate(StrOp::Parse, &["7."], &[])), 7.0);
    assert_eq!(num(evaluate(StrOp::Parse, &["abc"], &[])), 0.0);
    assert_eq!(num(evaluate(StrOp::Parse, &[""], &[])), 0.0);
}

#[test]
fn parse_hex_forms() {
    assert_eq!(num(evaluate(StrOp::Parse, &["id=0x1A2B end"], &[])), 6699.0);
    assert_eq!(num(evaluate(StrOp::Parse, &["0XFF"], &[])), 255.0);
    // 未命中 hex (无前缀字母结尾) 不误读
    assert_eq!(num(evaluate(StrOp::Parse, &["0x"], &[])), 0.0);
}

#[test]
fn parse_pos_is_one_based_char_index() {
    // 从第 5 个字符起扫描, 跳过前面的 "v=1." 部分
    assert_eq!(num(evaluate(StrOp::Parse, &["v=1.234"], &[5.0])), 234.0);
    // 多字节安全: pos 按 chars 计
    assert_eq!(num(evaluate(StrOp::Parse, &["温度:36.8度"], &[4.0])), 36.8);
    // pos 越界 → 0
    assert_eq!(num(evaluate(StrOp::Parse, &["1.5"], &[99.0])), 0.0);
}

#[test]
fn encode_hex_uppercase_utf8_bytes() {
    assert_eq!(text(evaluate(StrOp::EncodeHex, &["AB"], &[])), "4142");
    assert_eq!(text(evaluate(StrOp::EncodeHex, &["你"], &[])), "E4BDA0");
    assert_eq!(text(evaluate(StrOp::EncodeHex, &[""], &[])), "");
}

#[test]
fn new_ops_port_tables() {
    assert_eq!(
        StrOp::Format.input_ports(),
        &[
            PortSpec::new("fmt", PortDomain::String),
            PortSpec::new("in0", PortDomain::F32),
            PortSpec::new("in1", PortDomain::F32),
            PortSpec::new("in2", PortDomain::F32),
            PortSpec::new("in3", PortDomain::F32)
        ]
    );
    assert_eq!(
        StrOp::Parse.input_ports(),
        &[
            PortSpec::new("str", PortDomain::String),
            PortSpec::new("pos", PortDomain::F32)
        ]
    );
    assert_eq!(
        StrOp::EncodeHex.input_ports(),
        &[PortSpec::new("str", PortDomain::String)]
    );
    assert_eq!(StrOp::Format.output_domain(), PortDomain::String);
    assert_eq!(StrOp::Parse.output_domain(), PortDomain::F32);
    assert_eq!(StrOp::EncodeHex.output_domain(), PortDomain::String);
}

#[test]
fn new_ops_serde_names() {
    assert_eq!(serde_json::to_string(&StrOp::Format).unwrap(), "\"format\"");
    assert_eq!(serde_json::to_string(&StrOp::Parse).unwrap(), "\"parse\"");
    assert_eq!(
        serde_json::to_string(&StrOp::EncodeHex).unwrap(),
        "\"encode_hex\""
    );
    let op: StrOp = serde_json::from_str("\"encode_hex\"").unwrap();
    assert_eq!(op, StrOp::EncodeHex);
}

use super::*;

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

/// 数值断言统一入口 — 评估输出是整数映射出的精确 f32, 单点放宽浮点严格相等
#[allow(clippy::float_cmp)]
fn assert_num(actual: f32, expected: f32) {
    assert_eq!(actual, expected);
}

#[test]
fn len_counts_chars() {
    assert_num(num(StrOp::Len.evaluate(&["hello"], &[])), 5.0);
    assert_num(num(StrOp::Len.evaluate(&[""], &[])), 0.0);
    assert_num(num(StrOp::Len.evaluate(&["你好世界"], &[])), 4.0);
}

#[test]
fn find_is_one_based_char_index() {
    assert_num(
        num(StrOp::Find.evaluate(&["hello world", "world"], &[])),
        7.0,
    );
    assert_num(num(StrOp::Find.evaluate(&["hello", "xyz"], &[])), 0.0);
    assert_num(num(StrOp::Find.evaluate(&["你好世界", "世界"], &[])), 3.0);
}

#[test]
fn contains_returns_one_or_zero() {
    assert_num(num(StrOp::Contains.evaluate(&["hello", "ell"], &[])), 1.0);
    assert_num(num(StrOp::Contains.evaluate(&["hello", "xyz"], &[])), 0.0);
}

#[test]
fn left_right_zero_means_whole_string() {
    assert_eq!(text(StrOp::Left.evaluate(&["hello"], &[3.0])), "hel");
    assert_eq!(text(StrOp::Left.evaluate(&["hello"], &[0.0])), "hello");
    assert_eq!(text(StrOp::Left.evaluate(&["hello"], &[99.0])), "hello");
    assert_eq!(text(StrOp::Left.evaluate(&["你好世界"], &[2.0])), "你好");
    assert_eq!(text(StrOp::Right.evaluate(&["hello"], &[2.0])), "lo");
    assert_eq!(text(StrOp::Right.evaluate(&["hello"], &[0.0])), "hello");
    assert_eq!(text(StrOp::Right.evaluate(&["hello"], &[99.0])), "hello");
    assert_eq!(text(StrOp::Right.evaluate(&["你好世界"], &[2.0])), "世界");
}

#[test]
fn mid_clamps_and_supports_zero_len() {
    assert_eq!(
        text(StrOp::Mid.evaluate(&["hello world"], &[7.0, 5.0])),
        "world"
    );
    assert_eq!(text(StrOp::Mid.evaluate(&["hello"], &[2.0, 3.0])), "ell");
    assert_eq!(text(StrOp::Mid.evaluate(&["hello"], &[2.0, 0.0])), "ello");
    assert_eq!(text(StrOp::Mid.evaluate(&["hello"], &[0.0, 2.0])), "he");
    assert_eq!(text(StrOp::Mid.evaluate(&["hello"], &[99.0, 2.0])), "");
    assert_eq!(text(StrOp::Mid.evaluate(&["hello"], &[4.0, 99.0])), "lo");
    assert_eq!(text(StrOp::Mid.evaluate(&[""], &[1.0, 0.0])), "");
    assert_eq!(
        text(StrOp::Mid.evaluate(&["你好世界"], &[2.0, 2.0])),
        "好世"
    );
    assert_eq!(text(StrOp::Mid.evaluate(&["hello"], &[2.6, 1.0])), "l");
}

#[test]
fn concat_joins_two_strings() {
    assert_eq!(text(StrOp::Concat.evaluate(&["foo", "bar"], &[])), "foobar");
    assert_eq!(text(StrOp::Concat.evaluate(&["", ""], &[])), "");
}

#[test]
fn insert_clamps_position() {
    assert_eq!(text(StrOp::Insert.evaluate(&["acd", "b"], &[2.0])), "abcd");
    assert_eq!(text(StrOp::Insert.evaluate(&["bc", "a"], &[1.0])), "abc");
    assert_eq!(text(StrOp::Insert.evaluate(&["bc", "a"], &[0.0])), "abc");
    assert_eq!(text(StrOp::Insert.evaluate(&["ab", "c"], &[99.0])), "abc");
    assert_eq!(
        text(StrOp::Insert.evaluate(&["你好", "呀"], &[3.0])),
        "你好呀"
    );
}

#[test]
fn delete_zero_len_means_to_end() {
    assert_eq!(text(StrOp::Delete.evaluate(&["hello"], &[2.0, 3.0])), "ho");
    assert_eq!(text(StrOp::Delete.evaluate(&["hello"], &[3.0, 0.0])), "he");
    assert_eq!(
        text(StrOp::Delete.evaluate(&["hello"], &[6.0, 1.0])),
        "hello"
    );
    assert_eq!(
        text(StrOp::Delete.evaluate(&["hello"], &[99.0, 1.0])),
        "hello"
    );
    assert_eq!(text(StrOp::Delete.evaluate(&["hello"], &[2.0, 99.0])), "h");
    assert_eq!(
        text(StrOp::Delete.evaluate(&["你好世界"], &[2.0, 2.0])),
        "你界"
    );
}

#[test]
fn replace_zero_len_means_to_end() {
    assert_eq!(
        text(StrOp::Replace.evaluate(&["hello", "XY"], &[2.0, 3.0])),
        "hXYo"
    );
    assert_eq!(
        text(StrOp::Replace.evaluate(&["hello", "XY"], &[3.0, 0.0])),
        "heXY"
    );
    assert_eq!(
        text(StrOp::Replace.evaluate(&["hello", "XY"], &[6.0, 1.0])),
        "hello"
    );
    assert_eq!(
        text(StrOp::Replace.evaluate(&["hello", "XY"], &[4.0, 99.0])),
        "helXY"
    );
    assert_eq!(
        text(StrOp::Replace.evaluate(&["你好世界", "吧"], &[4.0, 1.0])),
        "你好世吧"
    );
}

#[test]
fn upper_lower_trim_reverse() {
    assert_eq!(text(StrOp::Upper.evaluate(&["hello"], &[])), "HELLO");
    assert_eq!(text(StrOp::Lower.evaluate(&["HeLLo"], &[])), "hello");
    assert_eq!(text(StrOp::Trim.evaluate(&["  hi \n"], &[])), "hi");
    assert_eq!(text(StrOp::Reverse.evaluate(&["hello"], &[])), "olleh");
    assert_eq!(text(StrOp::Reverse.evaluate(&["你好"], &[])), "好你");
}

#[test]
fn huge_len_does_not_overflow() {
    let huge = 1e20_f32;
    assert_eq!(text(StrOp::Mid.evaluate(&["hello"], &[2.0, huge])), "ello");
    assert_eq!(text(StrOp::Delete.evaluate(&["hello"], &[2.0, huge])), "h");
    assert_eq!(
        text(StrOp::Replace.evaluate(&["hello", "XY"], &[2.0, huge])),
        "hXY"
    );
}

#[test]
fn num_params_default() {
    let p = StrNumParams::default();
    assert_num(p.pos, 1.0);
    assert_num(p.len, 0.0);
    assert_num(p.size, 0.0);
}

#[test]
fn port_tables_match_constants() {
    assert_eq!(
        StrOp::Len.input_ports(),
        &[PortSpec::new("str", PortDomain::String)]
    );
    assert_eq!(
        StrOp::Mid.input_ports(),
        &[
            PortSpec::new("str", PortDomain::String),
            PortSpec::new("pos", PortDomain::F32),
            PortSpec::new("len", PortDomain::F32)
        ]
    );
    assert_eq!(
        StrOp::Replace.input_ports(),
        &[
            PortSpec::new("str1", PortDomain::String),
            PortSpec::new("str2", PortDomain::String),
            PortSpec::new("pos", PortDomain::F32),
            PortSpec::new("len", PortDomain::F32)
        ]
    );
    assert_eq!(StrOp::Len.output_domain(), PortDomain::F32);
    assert_eq!(StrOp::Find.output_domain(), PortDomain::F32);
    assert_eq!(StrOp::Contains.output_domain(), PortDomain::F32);
    assert_eq!(StrOp::Concat.output_domain(), PortDomain::String);
}

#[test]
fn serde_lowercase() {
    assert_eq!(
        serde_json::to_string(&StrOp::Replace).unwrap(),
        "\"replace\""
    );
    let op: StrOp = serde_json::from_str("\"mid\"").unwrap();
    assert_eq!(op, StrOp::Mid);
}

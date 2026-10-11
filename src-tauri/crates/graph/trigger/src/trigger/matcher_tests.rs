use super::super::test_util::{assert_value, rule, string_rule};
use super::*;

#[test]
fn match_exact() {
    let rules = vec![rule("r1", TriggerMatchType::Exact, "HELLO", 1.0, true)];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert!(m.match_input("HELLO", None).matched);
    assert_value(m.match_input("HELLO", None).value, 1.0);
    assert!(!m.match_input("hello", None).matched); // 大小写敏感
    assert!(!m.match_input("", None).matched);
}

#[test]
fn match_prefix_contains() {
    let rules = vec![
        rule("r1", TriggerMatchType::Prefix, "GET", 1.0, true),
        rule("r2", TriggerMatchType::Contains, "TEMP", 2.0, true),
    ];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert_value(m.match_input("GET_TEMP", None).value, 1.0); // 首个命中
    assert_value(m.match_input("SET_TEMP", None).value, 2.0);
    assert_value(m.match_input("SET_VOLT", None).value, 0.0); // 默认未命中
}

#[test]
fn match_regex() {
    let rules = vec![rule("r1", TriggerMatchType::Regex, r"^H.*O$", 5.0, true)];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert_value(m.match_input("HELLO", None).value, 5.0);
    assert_value(m.match_input("HEYLO", None).value, 5.0); // .* 匹配任意
    assert!(!m.match_input("HELP", None).matched); // 不以 O 结尾
    assert!(!m.match_input("AYO", None).matched); // 不以 H 开头
}

#[test]
fn match_regex_flags_case_insensitive() {
    let mut r = rule("r1", TriggerMatchType::Regex, "hello", 1.0, true);
    r.flags = Some("i".to_string());
    let mut m = TriggerMatcher::new(vec![r], 0.0, String::new());
    assert!(m.match_input("HELLO", None).matched);
    assert!(m.match_input("Hello", None).matched);
}

#[test]
fn match_regex_invalid_silent() {
    // 无效正则 (未闭合的字符类) — 不应 panic, 视为不命中
    let rules = vec![rule("r1", TriggerMatchType::Regex, "[", 9.0, true)];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    let r = m.match_input("anything", None);
    assert!(!r.matched);
    assert_value(r.value, 0.0);
}

#[test]
fn match_range_boundaries() {
    let rules = vec![rule("r1", TriggerMatchType::Range, "1..5", 7.0, true)];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    // 包含端点
    assert!(m.match_input("", Some(1.0)).matched);
    assert!(m.match_input("", Some(5.0)).matched);
    assert!(m.match_input("", Some(3.25)).matched);
    assert!(!m.match_input("", Some(0.999)).matched);
    assert!(!m.match_input("", Some(5.001)).matched);
    // 无 numeric 时跳过
    assert!(!m.match_input("", None).matched);
}

#[test]
fn match_disabled_rule_skipped() {
    let rules = vec![
        rule("r1", TriggerMatchType::Exact, "X", 1.0, false), // 禁用
        rule("r2", TriggerMatchType::Exact, "Y", 2.0, true),
    ];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert_value(m.match_input("X", None).value, 0.0); // r1 禁用, 默认值
    assert_value(m.match_input("Y", None).value, 2.0);
}

#[test]
fn match_first_hit_wins() {
    let rules = vec![
        rule("r1", TriggerMatchType::Contains, "T", 1.0, true),
        rule("r2", TriggerMatchType::Exact, "TEST", 2.0, true),
    ];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert_value(m.match_input("TEST", None).value, 1.0); // r1 先命中
}

#[test]
fn match_no_rules_returns_default_miss() {
    let mut m = TriggerMatcher::new(vec![], 99.0, String::new());
    assert!(!m.match_input("anything", None).matched);
    assert_value(m.match_input("anything", None).value, 99.0);
}

#[test]
fn match_string_output_rule() {
    let rules = vec![string_rule(
        "r1",
        TriggerMatchType::Exact,
        "HELLO",
        "world",
        true,
    )];
    let mut m = TriggerMatcher::new(rules, 0.0, "fallback".to_string());
    let r = m.match_input("HELLO", None);
    assert!(r.matched);
    assert_eq!(r.output_type, "string");
    assert_eq!(r.text, "world");
    // number 字段填 miss (命中规则未指定 number 输出)
    assert_value(r.value, 0.0);
}

#[test]
fn match_string_default_miss_returns_default_miss_text() {
    let mut m = TriggerMatcher::new(vec![], 42.0, "empty".to_string());
    let r = m.match_input("anything", None);
    assert!(!r.matched);
    assert_value(r.value, 42.0);
    assert_eq!(r.text, "empty");
    assert_eq!(r.output_type, "miss");
}

#[test]
fn match_glob_star() {
    let rules = vec![rule("r1", TriggerMatchType::Glob, "GET_*", 1.0, true)];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert!(m.match_input("GET_TEMP", None).matched);
    assert!(m.match_input("GET_VOLT", None).matched);
    assert!(!m.match_input("SET_TEMP", None).matched);
}

#[test]
fn match_glob_qmark() {
    let rules = vec![rule("r1", TriggerMatchType::Glob, "?_TEMP", 1.0, true)];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert!(m.match_input("A_TEMP", None).matched);
    assert!(m.match_input("X_TEMP", None).matched);
    assert!(!m.match_input("AB_TEMP", None).matched); // 通配单字符
}

#[test]
fn match_glob_charset() {
    let rules = vec![rule("r1", TriggerMatchType::Glob, "[GS]ET_*", 1.0, true)];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert!(m.match_input("GET_TEMP", None).matched);
    assert!(m.match_input("SET_VOLT", None).matched);
    assert!(!m.match_input("XET_VOLT", None).matched);
}

#[test]
fn match_glob_alternatives() {
    let rules = vec![rule(
        "r1",
        TriggerMatchType::Glob,
        "{HELLO,HI}_*",
        1.0,
        true,
    )];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert!(m.match_input("HELLO_TEMP", None).matched);
    assert!(m.match_input("HI_VOLT", None).matched);
    assert!(!m.match_input("BYE_TEMP", None).matched);
}

#[test]
fn match_glob_invalid_silent() {
    // 无效 glob (未闭合字符类) — 不应 panic, 视为不命中
    let rules = vec![rule("r1", TriggerMatchType::Glob, "[", 9.0, true)];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    let r = m.match_input("anything", None);
    assert!(!r.matched);
    assert_value(r.value, 0.0);
}

#[test]
fn glob_cache_reuses_compile() {
    let rules = vec![rule("r1", TriggerMatchType::Glob, "GET_*", 1.0, true)];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert!(m.match_input("GET_TEMP", None).matched);
    assert!(m.match_input("GET_VOLT", None).matched);
    assert_eq!(m.glob_cache.len(), 1);
}

#[test]
fn regex_cache_reuses_compile() {
    // 同一 rule.id 多次调用 — 仅编译一次
    let rules = vec![rule("r1", TriggerMatchType::Regex, r"\d+", 1.0, true)];
    let mut m = TriggerMatcher::new(rules, 0.0, String::new());
    assert!(m.match_input("abc1", None).matched);
    assert!(m.match_input("abc2", None).matched);
    assert_eq!(m.regex_cache.len(), 1);
}

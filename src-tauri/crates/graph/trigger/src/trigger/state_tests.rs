use super::super::test_util::rule;
use super::super::types::TriggerMatchType;
use super::*;

fn state_with_range_rule() -> TriggerState {
    // Range 规则: trigger 值落在 1..10 → 输出 7.0 (auto 模式用数值字符串作命令)
    TriggerState::new(
        vec![rule("r1", TriggerMatchType::Range, "1..10", 7.0, true)],
        0.0,
        String::new(),
    )
}

#[test]
fn edge_level_fires_every_frame_while_nonzero() {
    let mut st = state_with_range_rule();
    assert!(st.eval_auto("level", 0.0).is_none()); // 0 → 不激活
    assert!(st.eval_auto("level", 5.0).is_some());
    assert!(st.eval_auto("level", 5.0).is_some()); // 持续非零 → 每帧都匹配
    assert!(st.eval_auto("level", -1.0).is_some()); // 负值也激活 (!= 0)
    assert!(st.eval_auto("level", 0.0).is_none());
}

#[test]
fn edge_rising_fires_once_then_rearms() {
    let mut st = state_with_range_rule();
    // 上升沿: 0 → 5 触发一次
    assert!(st.eval_auto("rising", 0.0).is_none());
    let r = st.eval_auto("rising", 5.0).expect("上升沿应触发");
    assert!(r.matched);
    assert!((r.value - 7.0).abs() < f32::EPSILON);
    // 持续高位: 不再触发
    assert!(st.eval_auto("rising", 5.0).is_none());
    assert!(st.eval_auto("rising", 6.0).is_none()); // 非零 → 非零 不算上升沿
    // 回落到 0 后再升: 重新触发 (re-arm)
    assert!(st.eval_auto("rising", 0.0).is_none());
    assert!(st.eval_auto("rising", 3.0).is_some());
    // 负值不是上升沿 (prev==0 但 value 不 > 0)
    assert!(st.eval_auto("rising", 0.0).is_none());
    assert!(st.eval_auto("rising", -2.0).is_none());
}

#[test]
fn auto_match_uses_value_string_as_command() {
    // 前端 runMatch(String(triggerValue)): 命令为数值字符串形式
    let mut st = TriggerState::new(
        vec![rule("r1", TriggerMatchType::Exact, "5", 1.0, true)],
        0.0,
        String::new(),
    );
    assert!(st.eval_auto("level", 5.0).is_some_and(|r| r.matched));
    let mut st = TriggerState::new(
        vec![rule("r1", TriggerMatchType::Exact, "5", 1.0, true)],
        0.0,
        String::new(),
    );
    assert!(st.eval_auto("level", 5.5).is_some_and(|r| !r.matched));
}

#[test]
fn manual_eval_parses_numeric_for_range() {
    let mut st = state_with_range_rule();
    assert!(st.eval_manual("5").matched); // 可解析为数值 → Range 命中
    assert!(!st.eval_manual("abc").matched); // 非数值 → Range 跳过
    assert!(!st.eval_manual("").matched); // 空串 → None
}

#[test]
fn config_change_detection() {
    let rules = vec![rule("r1", TriggerMatchType::Exact, "X", 1.0, true)];
    let st = TriggerState::new(rules.clone(), 0.0, "miss".to_string());
    assert!(st.matches_config(&rules, 0.0, "miss"));
    assert!(!st.matches_config(&rules, 1.0, "miss")); // default_miss 变化
    assert!(!st.matches_config(&rules, 0.0, "other")); // default_miss_text 变化
    let rules2 = vec![rule("r1", TriggerMatchType::Exact, "Y", 1.0, true)];
    assert!(!st.matches_config(&rules2, 0.0, "miss")); // rules 变化
}

#[test]
fn format_auto_command_js_compat() {
    assert_eq!(format_auto_command(0.0), "0");
    assert_eq!(format_auto_command(-0.0), "0"); // JS String(-0) === "0"
    assert_eq!(format_auto_command(5.0), "5"); // 整数不带 .0
    assert_eq!(format_auto_command(1.5), "1.5");
    assert_eq!(format_auto_command(f32::NAN), "NaN");
    assert_eq!(format_auto_command(f32::INFINITY), "Infinity");
    assert_eq!(format_auto_command(f32::NEG_INFINITY), "-Infinity");
}

#[test]
fn record_prev_prevents_false_rising_after_manual() {
    // manual 期间输入 0→5 (record_prev 跟踪); 切回 auto+rising 且输入保持 5 → 不触发
    let mut st = state_with_range_rule();
    st.record_prev(0.0);
    st.record_prev(5.0);
    assert!(
        st.eval_auto("rising", 5.0).is_none(),
        "prev=5 不应误判上升沿"
    );
    // 回落后再升: 正常触发
    assert!(st.eval_auto("rising", 0.0).is_none());
    assert!(st.eval_auto("rising", 5.0).is_some());
}

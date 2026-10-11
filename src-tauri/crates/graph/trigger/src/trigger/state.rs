//! Trigger 节点求值状态 — 跨帧持久 (边沿检测 prev 值 + 匹配器)

use super::matcher::TriggerMatcher;
use super::types::{TriggerMatchResult, TriggerRuleDef};

/// 命令字符串 → Range 匹配数值 (对齐前端 `Number(trimmed)` + `Number.isFinite` 判定):
/// 空串 / 解析失败 / 非有限值 (NaN/±Infinity) → `None` (跳过 Range 规则)
fn numeric_of(command: &str) -> Option<f32> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed.parse::<f32>().ok().filter(|v| v.is_finite())
}

/// 自动模式匹配输入的命令字符串 — 对齐前端 `String(triggerValue)` (JS Number→String)
///
/// Rust `Display` 已覆盖常见情形 (整数不带 `.0`, 最短回 round-trip 小数);
/// 这里补齐 JS 语义差异: `-0` → `"0"`, NaN → `"NaN"`, ±∞ → `"Infinity"/"-Infinity"`。
/// 已知偏差: JS 对 |v| ≥ 1e21 或 < 1e-6 用指数记法 (`"1e+21"`), Rust `Display` 不用 —
/// 极端量级下 exact/prefix 等字符串规则的匹配结果可能与前端不一致。
#[must_use]
pub fn format_auto_command(v: f32) -> String {
    if v == 0.0 {
        "0".to_string()
    } else if v.is_nan() {
        "NaN".to_string()
    } else if v.is_infinite() {
        if v > 0.0 { "Infinity" } else { "-Infinity" }.to_string()
    } else {
        format!("{v}")
    }
}

/// Trigger 节点求值状态 — 跨帧持久 (regex/glob 缓存 + 边沿检测 prev 值)
///
/// 生命周期仿 `filter_states` (DigitalFilter): 图求值时懒建,
/// 匹配器相关配置 (rules/default_miss/default_miss_text) 变化时重建,
/// 节点删除时由调用方清理。
/// mode/edge/command 不参与重建比较 — 求值时现读 (对齐前端: 这些变更不重置 prevTriggerRef,
/// 但规则/default 变更会导致重建并复位 prev_trigger, 与 Filter kind 变更重建同语义)。
pub struct TriggerState {
    matcher: TriggerMatcher,
    /// 重建依据快照 (仅匹配器相关配置)
    rules: Vec<TriggerRuleDef>,
    default_miss: f32,
    default_miss_text: String,
    /// 自动模式边沿检测: 上一帧 trigger 输入值 (对齐前端 prevTriggerRef, 初始 0)
    prev_trigger: f32,
}

impl TriggerState {
    #[must_use]
    pub fn new(rules: Vec<TriggerRuleDef>, default_miss: f32, default_miss_text: String) -> Self {
        Self {
            matcher: TriggerMatcher::new(rules.clone(), default_miss, default_miss_text.clone()),
            rules,
            default_miss,
            default_miss_text,
            prev_trigger: 0.0,
        }
    }

    /// 匹配器相关配置是否一致 (不一致 → 调用方重建, 同 Filter 的 kind 变化重建)
    #[allow(clippy::float_cmp)] // 配置同一性比较 (按位相等即重建), 非数值逼近
    pub fn matches_config(
        &self,
        rules: &[TriggerRuleDef],
        default_miss: f32,
        default_miss_text: &str,
    ) -> bool {
        self.rules == rules
            && self.default_miss == default_miss
            && self.default_miss_text == default_miss_text
    }

    /// 手动模式求值: 以 command 直接匹配 (前端 Fire 按钮的 runMatch 等价物)
    pub fn eval_manual(&mut self, command: &str) -> TriggerMatchResult {
        self.matcher.match_input(command, numeric_of(command))
    }

    /// 非 auto 模式下的 prev 跟踪 — 对齐前端 useEffect
    /// (`mode !== 'auto'` 时仍每帧 `prevTriggerRef.current = triggerValue`):
    /// 保证 manual 期间输入 0→正 后切回 auto+rising 不会因陈旧 prev 误触发上升沿
    pub const fn record_prev(&mut self, trigger_value: f32) {
        self.prev_trigger = trigger_value;
    }

    /// 自动模式求值: 边沿检测 + 命中时匹配 (对齐前端 Trigger.tsx 的 useEffect)
    ///
    /// - `edge == "rising"`: 仅 `prev == 0 && value > 0` 的上升沿匹配一次
    /// - 其他 (`"level"`): `value != 0` 期间每帧匹配
    /// - 未激活返回 `None` (本帧不更新输出, 端口保持上次值); `prev_trigger` 每帧更新
    ///
    /// 匹配输入对齐前端 `runMatch(String(triggerValue))`:
    /// 命令为数值的字符串形式, Range 数值为该值本身 (非有限 → None)
    pub fn eval_auto(&mut self, edge: &str, trigger_value: f32) -> Option<TriggerMatchResult> {
        let prev = self.prev_trigger;
        self.prev_trigger = trigger_value;
        let active = if edge == "rising" {
            prev == 0.0 && trigger_value > 0.0
        } else {
            trigger_value != 0.0
        };
        if !active {
            return None;
        }
        let cmd = format_auto_command(trigger_value);
        let numeric = trigger_value.is_finite().then_some(trigger_value);
        Some(self.matcher.match_input(&cmd, numeric))
    }
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;

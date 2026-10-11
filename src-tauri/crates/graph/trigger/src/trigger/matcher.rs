//! 触发器匹配器 — 规则顺序求值 + 正则/glob 编译缓存

use std::collections::HashMap;

use glob::Pattern;
use regex::Regex;

use super::pattern::{compile_regex, glob_to_regex_source, parse_range};
use super::types::{TriggerMatchResult, TriggerMatchType, TriggerRuleDef};

/// 触发器匹配器 (无状态, 每次命令构建一次或复用)
pub struct TriggerMatcher {
    rules: Vec<TriggerRuleDef>,
    default_miss: f32,
    default_miss_text: String,
    /// 按 rule.id 缓存编译后的正则 (`None` = 上次编译失败, 视为不命中)
    regex_cache: HashMap<String, Option<Regex>>,
    /// 按 rule.id 缓存编译后的 glob (同上)
    glob_cache: HashMap<String, Option<Pattern>>,
}

impl TriggerMatcher {
    #[must_use]
    pub fn new(rules: Vec<TriggerRuleDef>, default_miss: f32, default_miss_text: String) -> Self {
        Self {
            rules,
            default_miss,
            default_miss_text,
            regex_cache: HashMap::new(),
            glob_cache: HashMap::new(),
        }
    }

    /// 执行一次匹配
    ///
    /// - `command`: 待匹配命令字符串
    /// - `numeric`: 用于 `Range` 匹配的数值; `None` 时跳过 Range 规则
    ///
    /// 返回首个命中规则 (按 output_type 取对应字段) 或默认 miss。
    pub fn match_input(&mut self, command: &str, numeric: Option<f32>) -> TriggerMatchResult {
        // 借用规则副本避免与 `&mut self` 冲突 (regex/glob cache 写入需可变借用)
        let snapshot = self.rules.clone();
        for rule in &snapshot {
            if !rule.enabled {
                continue;
            }
            let hit = self.eval_rule(rule, command, numeric);
            if hit {
                if rule.output_type == "string" {
                    return TriggerMatchResult {
                        value: self.default_miss,
                        matched: true,
                        text: rule.output_text.clone(),
                        output_type: "string".to_string(),
                    };
                }
                return TriggerMatchResult {
                    value: rule.output_value,
                    matched: true,
                    text: self.default_miss_text.clone(),
                    output_type: "number".to_string(),
                };
            }
        }
        TriggerMatchResult {
            value: self.default_miss,
            matched: false,
            text: self.default_miss_text.clone(),
            output_type: "miss".to_string(),
        }
    }

    fn eval_rule(&mut self, rule: &TriggerRuleDef, command: &str, numeric: Option<f32>) -> bool {
        match rule.match_type {
            TriggerMatchType::Exact => command == rule.pattern,
            TriggerMatchType::Prefix => command.starts_with(&rule.pattern),
            TriggerMatchType::Contains => command.contains(&rule.pattern),
            TriggerMatchType::Regex => self
                .get_or_compile_regex(&rule.id, &rule.pattern, rule.flags.as_deref().unwrap_or(""))
                .is_some_and(|re| re.is_match(command)),
            TriggerMatchType::Range => numeric.is_some_and(|n| {
                parse_range(&rule.pattern).is_some_and(|(lo, hi)| n >= lo && n <= hi)
            }),
            TriggerMatchType::Glob => {
                if rule.pattern.contains('{') {
                    // brace-expansion: 把 `{a,b}` 编译为正则 (缓存 key: "{id}:g")
                    let key = format!("{}:g", rule.id);
                    if !self.regex_cache.contains_key(&key) {
                        let regex_src = glob_to_regex_source(&rule.pattern);
                        let compiled = compile_regex(&regex_src, "").ok();
                        self.regex_cache.insert(key.clone(), compiled);
                    }
                    self.regex_cache
                        .get(&key)
                        .and_then(Option::as_ref)
                        .is_some_and(|re| re.is_match(command))
                } else {
                    self.get_or_compile_glob(&rule.id, &rule.pattern)
                        .is_some_and(|p| p.matches(command))
                }
            }
        }
    }

    /// 取缓存或编译; 失败时缓存 `None` 并返回之 (视为不命中, 不抛错)
    fn get_or_compile_regex(&mut self, id: &str, pattern: &str, flags: &str) -> Option<&Regex> {
        if !self.regex_cache.contains_key(id) {
            let compiled = match compile_regex(pattern, flags) {
                Ok(re) => Some(re),
                Err(e) => {
                    log::warn!(
                        "trigger rule {id}: invalid regex pattern {pattern:?} flags {flags:?}: {e}"
                    );
                    None
                }
            };
            self.regex_cache.insert(id.to_string(), compiled);
        }
        self.regex_cache.get(id).and_then(Option::as_ref)
    }

    /// 同上, glob 版 (仅处理不含 `{...}` 的模式; 含 brace 的由 eval_rule 单独分支处理)
    fn get_or_compile_glob(&mut self, id: &str, pattern: &str) -> Option<&Pattern> {
        if !self.glob_cache.contains_key(id) {
            let compiled = match Pattern::new(pattern) {
                Ok(p) => Some(p),
                Err(e) => {
                    log::warn!("trigger rule {id}: invalid glob pattern {pattern:?}: {e}");
                    None
                }
            };
            self.glob_cache.insert(id.to_string(), compiled);
        }
        self.glob_cache.get(id).and_then(Option::as_ref)
    }
}

#[cfg(test)]
#[path = "matcher_tests.rs"]
mod tests;

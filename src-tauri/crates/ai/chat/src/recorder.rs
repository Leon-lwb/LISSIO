//! 回合记录器 — 把流式事件聚合成可持久化的助手视图条目。
//!
//! 会话所有权在后端后, `ai` 在转发事件给前端的同一回调里喂给
//! [`TurnRecorder`];回合终态 (Done / Cancelled / Error) 后调用 [`TurnRecorder::finish`]
//! 得到待落盘条目。语义与前端视图聚合规则一致:
//! - 文本与工具卡片聚合为一条 assistant 条目
//! - `Error` 事件单独产出一条 error 条目 (不进 LLM 历史, 见 `chat_session::history`)
//! - 未收到结果的工具调用在收束时标记为失败, 避免持久化"永远运行中"的卡片

use std::collections::BTreeMap;
use std::time::Instant;

use chat_session::{ToolRunDto, TurnEventDto, ViewItemDto, ViewRoleDto};
use serde_json::Value;

use crate::events::AiChatEvent;

/// 终止错误 — 原始描述 + 本地化所需的结构化字段。
#[derive(Debug, Default)]
struct TurnError {
    message: String,
    kind: String,
    data: Value,
}

impl TurnError {
    fn from_event(message: &str, kind: &str, data: &Value) -> Self {
        Self {
            message: message.to_string(),
            kind: kind.to_string(),
            data: data.clone(),
        }
    }

    /// 事件 data (JSON) → 字符串映射 (仅保留字符串字段, 与前端对齐)。
    fn data_map(&self) -> Option<BTreeMap<String, String>> {
        let obj = self.data.as_object()?;
        let map: BTreeMap<String, String> = obj
            .iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
            .collect();
        (!map.is_empty()).then_some(map)
    }
}

/// 单次助手回合的聚合器。
#[derive(Debug)]
pub struct TurnRecorder {
    started_at: Instant,
    text: String,
    reasoning: String,
    timeline: Vec<TurnEventDto>,
    tools: Vec<ToolRunDto>,
    error: Option<TurnError>,
}

impl TurnRecorder {
    /// 新建聚合器。
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
            text: String::new(),
            reasoning: String::new(),
            timeline: Vec::new(),
            tools: Vec::new(),
            error: None,
        }
    }

    /// 记录一条事件 (仅消费聚合相关事件, Done / Cancelled 忽略)。
    pub fn record(&mut self, event: &AiChatEvent) {
        match event {
            AiChatEvent::Delta { text } => {
                self.text.push_str(text);
                if let Some(TurnEventDto::Text { text: previous }) = self.timeline.last_mut() {
                    previous.push_str(text);
                } else {
                    self.timeline
                        .push(TurnEventDto::Text { text: text.clone() });
                }
            }
            AiChatEvent::ToolCall {
                id,
                name,
                arguments,
            } => {
                self.tools.push(ToolRunDto {
                    id: id.clone(),
                    name: name.clone(),
                    arguments: arguments.clone(),
                    text_offset: self.text.encode_utf16().count(),
                    content: String::new(),
                    is_error: false,
                    done: false,
                });
                self.timeline.push(TurnEventDto::Tool { id: id.clone() });
            }
            AiChatEvent::ToolResult {
                id,
                content,
                is_error,
                ..
            } => {
                if let Some(run) = self.tools.iter_mut().find(|run| run.id == *id) {
                    run.content.clone_from(content);
                    run.is_error = *is_error;
                    run.done = true;
                }
            }
            AiChatEvent::Error {
                message,
                kind,
                data,
            } => {
                self.error = Some(TurnError::from_event(message, kind, data));
            }
            AiChatEvent::ReasoningDelta { text } => {
                self.reasoning.push_str(text);
                if let Some(TurnEventDto::Reasoning { text: previous }) = self.timeline.last_mut() {
                    previous.push_str(text);
                } else {
                    self.timeline
                        .push(TurnEventDto::Reasoning { text: text.clone() });
                }
            }
            AiChatEvent::Done { .. } | AiChatEvent::Cancelled => {}
        }
    }

    /// 回合收束 — 产出待持久化条目。
    ///
    /// 文本与工具均空且无错误时不产出 (空回合不落盘);
    /// 未完成的工具调用在副本上标记为失败收束。
    pub fn finish(&self) -> Vec<ViewItemDto> {
        let mut out = Vec::new();
        if !self.text.is_empty() || !self.reasoning.is_empty() || !self.tools.is_empty() {
            let tools: Vec<ToolRunDto> = self
                .tools
                .iter()
                .map(|run| ToolRunDto {
                    done: true,
                    is_error: run.is_error || !run.done,
                    ..run.clone()
                })
                .collect();
            out.push(ViewItemDto {
                role: ViewRoleDto::Assistant,
                text: self.text.clone(),
                attachments: None,
                tools: (!tools.is_empty()).then_some(tools),
                timeline: Some(self.timeline.clone()),
                reasoning: (!self.reasoning.is_empty()).then(|| self.reasoning.clone()),
                duration_ms: Some(
                    u64::try_from(self.started_at.elapsed().as_millis()).unwrap_or(u64::MAX),
                ),
                error: None,
                error_kind: None,
                error_data: None,
            });
        }
        if let Some(err) = &self.error {
            out.push(ViewItemDto {
                role: ViewRoleDto::Assistant,
                text: err.message.clone(),
                attachments: None,
                tools: None,
                timeline: None,
                reasoning: None,
                duration_ms: None,
                error: Some(true),
                error_kind: (!err.kind.is_empty()).then(|| err.kind.clone()),
                error_data: err.data_map(),
            });
        }
        out
    }
}

impl Default for TurnRecorder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "recorder_tests.rs"]
mod tests;

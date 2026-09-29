//! 仅在新会话首轮提供的标题工具，由会话存储直接执行。

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use chat::ToolExecutor;
use chat_session::SessionStore;
use error::{McpError, Result};
use llm::ToolSpecDto;
use serde_json::{Value, json};

use super::CompositeExecutor;

const TOOL_NAME: &str = "set_conversation_title";

fn tool_error(details: &str) -> error::AppError {
    McpError::ToolFailed {
        tool: TOOL_NAME.to_string(),
        details: details.to_string(),
    }
    .into()
}

/// 将首轮专用的会话标题工具附加到常规工具执行器。
pub struct ConversationTitleExecutor {
    inner: CompositeExecutor,
    sessions: Arc<SessionStore>,
    session_id: String,
    expected_title: String,
    enabled: AtomicBool,
}

impl ConversationTitleExecutor {
    pub const fn new(
        inner: CompositeExecutor,
        sessions: Arc<SessionStore>,
        session_id: String,
        expected_title: String,
        enabled: bool,
    ) -> Self {
        Self {
            inner,
            sessions,
            session_id,
            expected_title,
            enabled: AtomicBool::new(enabled),
        }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for ConversationTitleExecutor {
    fn tools(&self) -> Vec<ToolSpecDto> {
        let mut tools = self.inner.tools();
        if self.enabled.load(Ordering::Acquire) {
            tools.push(ToolSpecDto {
                name: TOOL_NAME.to_string(),
                description: "Set a concise title for this new conversation based on the first user request. Call once during the first assistant turn; do not mention the title in the reply.".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "A specific, short conversation title (up to 40 characters)"}
                    },
                    "required": ["title"],
                    "additionalProperties": false
                }),
            });
        }
        tools
    }

    async fn call(&self, name: &str, arguments: Value) -> Result<String> {
        if name != TOOL_NAME {
            return self.inner.call(name, arguments).await;
        }
        if !self.enabled.load(Ordering::Acquire) {
            return Err(tool_error("标题工具只在新会话首轮可用"));
        }
        let title = arguments
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .trim_matches(|c| matches!(c, '"' | '\'' | '“' | '”' | '‘' | '’'))
            .trim();
        if title.is_empty()
            || title.chars().count() > 40
            || title.contains('\n')
            || title.contains('\r')
        {
            return Err(tool_error("标题须为单行非空文本，最多 40 字符"));
        }
        let renamed =
            self.sessions
                .rename_if_matches(&self.session_id, &self.expected_title, title)?;
        self.enabled.store(false, Ordering::Release);
        Ok(if renamed {
            format!("Conversation title set to: {title}")
        } else {
            "Conversation title was already changed by the user; kept it unchanged.".to_string()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn title_tool_is_first_turn_only_and_preserves_manual_rename() {
        let dir = std::env::temp_dir().join(format!(
            "lissio-title-tool-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let sessions = Arc::new(SessionStore::empty(&dir));
        let first = sessions.create("新会话").unwrap();
        let executor = ConversationTitleExecutor::new(
            CompositeExecutor::new(None, None),
            Arc::clone(&sessions),
            first.id.clone(),
            first.title,
            true,
        );
        assert!(executor.tools().iter().any(|tool| tool.name == TOOL_NAME));
        executor
            .call(TOOL_NAME, json!({"title": "串口帧解析"}))
            .await
            .unwrap();
        assert_eq!(sessions.get(&first.id).unwrap().title, "串口帧解析");
        assert!(!executor.tools().iter().any(|tool| tool.name == TOOL_NAME));
        assert!(
            executor
                .call(TOOL_NAME, json!({"title": "二次命名"}))
                .await
                .is_err()
        );

        let second = sessions.create("新会话").unwrap();
        let executor = ConversationTitleExecutor::new(
            CompositeExecutor::new(None, None),
            Arc::clone(&sessions),
            second.id.clone(),
            second.title,
            true,
        );
        sessions.rename(&second.id, "用户指定名称").unwrap();
        executor
            .call(TOOL_NAME, json!({"title": "模型名称"}))
            .await
            .unwrap();
        assert_eq!(sessions.get(&second.id).unwrap().title, "用户指定名称");
        std::fs::remove_dir_all(dir).ok();
    }
}

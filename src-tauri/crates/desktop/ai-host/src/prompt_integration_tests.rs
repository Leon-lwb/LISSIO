use std::sync::Arc;

use super::*;
use crate::test_support::unique_temp_path;

#[tokio::test]
async fn invalid_prompt_does_not_append_user_turn() {
    let dir = unique_temp_path("lissio-ai-turn-prompt");
    let host = AiHost::new(
        dir.clone(),
        Toolbox::from_state(&app::AppState::new()),
        Arc::new(events::NullEventSink),
    );
    let session = chat_create_session(&host, "新会话".into()).expect("创建会话");
    std::fs::write(dir.join(prompt::PROMPT_FILE_NAME), " \n ").expect("模拟空提示词");

    let result = ai_chat_send(
        &host,
        session.id.clone(),
        Some("测试请求".into()),
        None,
        false,
        AiProviderConfig {
            adapter: "openai".into(),
            base_url: String::new(),
            api_key: "unused-test-key".into(),
            model: "test-model".into(),
            temperature: None,
            max_tokens: None,
        },
        false,
        false,
        Some("zh".into()),
        Arc::new(|_| {}),
        Arc::new(events::NullEventSink),
    )
    .await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains(prompt::PROMPT_FILE_NAME)
    );
    assert!(
        chat_get_session(&host, session.id)
            .expect("会话仍存在")
            .items
            .is_empty()
    );
    std::fs::remove_dir_all(dir).ok();
}

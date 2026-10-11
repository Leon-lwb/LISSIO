use super::*;
use crate::test_support::unique_temp_path;

#[tokio::test]
async fn title_tool_is_first_turn_only_and_preserves_manual_rename() {
    let dir = unique_temp_path("lissio-title-tool");
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
